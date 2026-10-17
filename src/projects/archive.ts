import * as Blockly from 'blockly/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { version as APP_VERSION } from '../../package.json';
import { arduinoGenerator } from '../blocks/arduino-generator';
import { registerBuiltInFamilies } from '../blocks/index';
import { currentChip, currentPinProfile, setCurrentChip, setPinProfile } from '../blocks/pins';
import { getBoard } from '../boards/registry';
import { PROJECT_SCHEMA_VERSION, type Project } from './types';

// Export/import of a project as a .zip. Layout idea (a folder named like the sketch holding
// `<name>.ino`, so the Arduino IDE opens it directly) follows duinoapp/duinoapp-client
// src/plugins/bundler.js, which also zips with fflate; that file is GPL, so only the idea is
// reused. We add workspace.json + project.json so the blocks round-trip, and size caps.

/** Largest file `importProjectFile` reads, and the largest entry it inflates from a zip. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type ImportErrorCode = 'too-big' | 'unreadable' | 'not-a-project';

export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImportError';
    this.code = code;
  }
}

/** A project read from a file, before it gets an id and a board check. */
export interface ImportedProject {
  name: string;
  /** As written in the file; may be unknown to this build or missing. */
  boardId: string | null;
  workspace: unknown;
}

/**
 * Arduino sketch name for a project: the IDE requires the folder name to equal the .ino
 * name, so it is kept to ASCII letters, digits and `_`, starting with a letter, at most
 * 63 characters. Accents are dropped (`Semáforo` → `Semaforo`).
 */
export function sketchName(name: string): string {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let safe = ascii
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!safe) safe = 'proyecto';
  if (!/^[A-Za-z]/.test(safe)) safe = `p_${safe}`;
  return safe.slice(0, 63);
}

function withHeadlessWorkspace<T>(state: unknown, run: (workspace: Blockly.Workspace) => T): T {
  registerBuiltInFamilies();
  const workspace = new Blockly.Workspace();
  // Loading fires events; none of them may reach the editor's listeners.
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(state as Record<string, unknown>, workspace);
    return run(workspace);
  } finally {
    workspace.dispose();
    Blockly.Events.enable();
  }
}

/**
 * The sketch the generator produces for a stored workspace on a given board. `somLink`
 * links SomLink in (a "sube por WiFi" project on a board that supports it).
 */
export function generateSketch(
  workspace: unknown,
  boardId: string,
  { somLink = false }: { somLink?: boolean } = {},
): string {
  const previous = currentPinProfile();
  const previousChip = currentChip();
  const previousSomLink = arduinoGenerator.linksSomLink;
  const board = getBoard(boardId);
  setPinProfile(board.pins);
  setCurrentChip(board.chip);
  arduinoGenerator.setSomLink(somLink);
  try {
    return withHeadlessWorkspace(workspace, (ws) => arduinoGenerator.workspaceToCode(ws));
  } finally {
    setPinProfile(previous);
    setCurrentChip(previousChip);
    arduinoGenerator.setSomLink(previousSomLink);
  }
}

/** True when Blockly can load the state (used to reject broken imports up front). */
export function isLoadableWorkspace(state: unknown): boolean {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return false;
  // Blockly ignores keys it has no serializer for, so any object would "load" as an empty
  // workspace. Accept only Blockly's own shape: `{}` (empty) or blocks/variables.
  const keys = Object.keys(state);
  if (keys.length > 0 && !keys.some((key) => key === 'blocks' || key === 'variables')) {
    return false;
  }
  try {
    withHeadlessWorkspace(state, () => undefined);
    return true;
  } catch {
    return false;
  }
}

export interface ProjectArchive {
  filename: string;
  bytes: Uint8Array;
}

/** Zip `<sketch>/<sketch>.ino`, `<sketch>/workspace.json` and `<sketch>/project.json`. */
export function buildProjectZip(
  project: Project,
  code: string,
  exportedAt: number = Date.now(),
): ProjectArchive {
  const base = sketchName(project.name);
  const meta = {
    name: project.name,
    boardId: project.boardId,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    appVersion: APP_VERSION,
  };
  const bytes = zipSync({
    [base]: {
      [`${base}.ino`]: strToU8(code),
      'workspace.json': strToU8(JSON.stringify(project.workspace ?? {}, null, 2)),
      'project.json': strToU8(JSON.stringify(meta, null, 2)),
    },
  });
  return { filename: `${base}.zip`, bytes };
}

function baseName(filename: string): string {
  const name = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return name.trim() || 'proyecto';
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new ImportError('unreadable');
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Most `project.json` / `workspace.json` entries a zip may hold (ours has one of each). */
export const MAX_ZIP_JSON_ENTRIES = 4;

function readZip(bytes: Uint8Array, filename: string): ImportedProject {
  let oversized = false;
  let accepted = 0;
  let declaredTotal = 0;
  let entries: Record<string, Uint8Array>;
  try {
    // Only the JSON files are inflated, only a few of them, and only while their declared
    // sizes add up to the cap (fflate inflates into a buffer of exactly the declared size,
    // so a lying header cannot grow it): a zip bomb — one huge entry or hundreds of small
    // ones — is refused before any large allocation.
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (!/(^|\/)(project|workspace)\.json$/.test(file.name)) return false;
        accepted += 1;
        declaredTotal += file.originalSize;
        if (accepted > MAX_ZIP_JSON_ENTRIES || declaredTotal > MAX_IMPORT_BYTES) {
          oversized = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new ImportError('unreadable');
  }
  if (oversized) throw new ImportError('too-big');

  const names = Object.keys(entries).sort((a, b) => a.length - b.length);
  const projectPath = names.find((n) => /(^|\/)project\.json$/.test(n));
  const dir = projectPath ? projectPath.slice(0, -'project.json'.length) : null;
  const workspacePath =
    dir !== null && entries[`${dir}workspace.json`]
      ? `${dir}workspace.json`
      : names.find((n) => /(^|\/)workspace\.json$/.test(n));
  const workspaceBytes = workspacePath ? entries[workspacePath] : undefined;
  if (!workspaceBytes) throw new ImportError('not-a-project');

  const meta = projectPath && entries[projectPath] ? parseJson(entries[projectPath]) : {};
  const { name, boardId } = (typeof meta === 'object' && meta ? meta : {}) as {
    name?: unknown;
    boardId?: unknown;
  };
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : baseName(filename),
    boardId: typeof boardId === 'string' ? boardId : null,
    workspace: parseJson(workspaceBytes),
  };
}

/** Read one of our exported zips, or a bare Blockly workspace `.json`. */
export async function readProjectFile(file: File): Promise<ImportedProject> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('too-big');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError('too-big');

  const imported = isZip(bytes)
    ? readZip(bytes, file.name)
    : { name: baseName(file.name), boardId: null, workspace: parseJson(bytes) };
  if (!isLoadableWorkspace(imported.workspace)) throw new ImportError('not-a-project');
  return { ...imported, name: imported.name.slice(0, 100) };
}

/** Save bytes through a temporary `<a download>` (no file-saver dependency). */
export function downloadFile(bytes: Uint8Array, filename: string, type = 'application/zip'): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
