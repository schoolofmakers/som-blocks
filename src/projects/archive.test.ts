import * as Blockly from 'blockly/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { arduinoGenerator } from '../blocks/arduino-generator';
import { registerBuiltInFamilies } from '../blocks/index';
import { currentPinProfile, setPinProfile } from '../blocks/pins';
import { getBoard } from '../boards/registry';
import {
  buildProjectZip,
  generateSketch,
  ImportError,
  isLoadableWorkspace,
  MAX_IMPORT_BYTES,
  readProjectFile,
  sketchName,
} from './archive';
import { PROJECT_SCHEMA_VERSION, type Project } from './types';

/** The board LED on, then a raw statement: pin-dependent, so the board matters. */
const LED_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'som_io_builtin_led',
        x: 20,
        y: 20,
        fields: { STATE: 'ON' },
        next: { block: { type: 'som_raw_statement', fields: { CODE: 'blink();' } } },
      },
    ],
  },
};

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Semáforo de Ñuñoa!',
    boardId: 'uno',
    workspace: LED_WORKSPACE,
    createdAt: 1,
    updatedAt: 2,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...overrides,
  };
}

/** What the live editor's generator emits for the workspace on the board. */
function liveGenerator(state: unknown, boardId: string): string {
  registerBuiltInFamilies();
  const previous = currentPinProfile();
  setPinProfile(getBoard(boardId).pins);
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(state as Record<string, unknown>, ws);
    return arduinoGenerator.workspaceToCode(ws);
  } finally {
    ws.dispose();
    setPinProfile(previous);
  }
}

function fileOf(bytes: Uint8Array | string, name: string): File {
  return new File([typeof bytes === 'string' ? bytes : (bytes as Uint8Array<ArrayBuffer>)], name);
}

describe('sketchName', () => {
  it('refuses a zip with many small JSON entries (bomb by count)', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 50; i += 1) files[`d${i}/workspace.json`] = strToU8('{}');
    const zip = zipSync(files);
    await expect(readProjectFile(fileOf(zip, 'many.zip'))).rejects.toMatchObject({
      code: 'too-big',
    });
  });

  it('refuses entries whose sizes only add up past the cap', async () => {
    const part = strToU8(' '.repeat(2 * 1024 * 1024));
    const zip = zipSync({
      a: { 'workspace.json': part, 'project.json': part },
      b: { 'workspace.json': part },
    });
    await expect(readProjectFile(fileOf(zip, 'sum.zip'))).rejects.toMatchObject({
      code: 'too-big',
    });
  });

  it.each([
    ['Semáforo de Ñuñoa!', 'Semaforo_de_Nunoa'],
    ['mi proyecto (2)', 'mi_proyecto_2'],
    ['2 robots', 'p_2_robots'],
    ['   ', 'proyecto'],
    ['🚀🚀', 'proyecto'],
    ['../../etc/passwd', 'etc_passwd'],
    ['a'.repeat(80), 'a'.repeat(63)],
  ])('%j → %j', (name, expected) => {
    expect(sketchName(name)).toBe(expected);
    expect(sketchName(name)).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,62}$/);
  });
});

describe('generateSketch', () => {
  it('uses the project board and restores the editor pin profile', () => {
    const before = currentPinProfile();
    const code = generateSketch(LED_WORKSPACE, 'uno');
    expect(code).toContain('pinMode(13, OUTPUT);');
    expect(code).toBe(liveGenerator(LED_WORKSPACE, 'uno'));
    expect(currentPinProfile()).toBe(before);
    expect(generateSketch(LED_WORKSPACE, 'esp32c3-supermini')).toContain('pinMode(8, OUTPUT);');
  });
});

describe('buildProjectZip', () => {
  it('zips <sketch>/<sketch>.ino, workspace.json and project.json', () => {
    const p = project();
    const code = generateSketch(p.workspace, p.boardId);
    const { filename, bytes } = buildProjectZip(p, code, Date.UTC(2026, 9, 16));
    expect(filename).toBe('Semaforo_de_Nunoa.zip');

    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      'Semaforo_de_Nunoa/', // the folder entry
      'Semaforo_de_Nunoa/Semaforo_de_Nunoa.ino',
      'Semaforo_de_Nunoa/project.json',
      'Semaforo_de_Nunoa/workspace.json',
    ]);
    const ino = strFromU8(files['Semaforo_de_Nunoa/Semaforo_de_Nunoa.ino']!);
    expect(ino).toBe(liveGenerator(LED_WORKSPACE, 'uno'));
    expect(JSON.parse(strFromU8(files['Semaforo_de_Nunoa/workspace.json']!))).toEqual(
      LED_WORKSPACE,
    );
    expect(JSON.parse(strFromU8(files['Semaforo_de_Nunoa/project.json']!))).toEqual({
      name: 'Semáforo de Ñuñoa!',
      boardId: 'uno',
      schemaVersion: 1,
      exportedAt: '2026-10-16T00:00:00.000Z',
      appVersion: expect.any(String),
    });
  });
});

describe('readProjectFile', () => {
  it('round-trips an exported zip', async () => {
    const p = project();
    const { filename, bytes } = buildProjectZip(p, 'void setup() {}');
    await expect(readProjectFile(fileOf(bytes, filename))).resolves.toEqual({
      name: 'Semáforo de Ñuñoa!',
      boardId: 'uno',
      workspace: LED_WORKSPACE,
    });
  });

  it('reads a bare Blockly workspace .json, named after the file', async () => {
    const file = fileOf(JSON.stringify(LED_WORKSPACE), 'luces.json');
    await expect(readProjectFile(file)).resolves.toEqual({
      name: 'luces',
      boardId: null,
      workspace: LED_WORKSPACE,
    });
  });

  it('keeps an unknown board id for the caller to replace', async () => {
    const { bytes } = buildProjectZip(project({ boardId: 'board-from-the-future' }), '');
    const imported = await readProjectFile(fileOf(bytes, 'x.zip'));
    expect(imported.boardId).toBe('board-from-the-future');
  });

  it('refuses files over 5 MB before reading them', async () => {
    const big = fileOf('x'.repeat(MAX_IMPORT_BYTES + 1), 'big.json');
    await expect(readProjectFile(big)).rejects.toMatchObject({ code: 'too-big' });
  });

  it('refuses a zip whose workspace inflates past the cap (zip bomb)', async () => {
    // 6 MB of spaces deflates to a few KB: a small file that would be huge in memory.
    const bomb = zipSync({ p: { 'workspace.json': strToU8(' '.repeat(6 * 1024 * 1024)) } });
    expect(bomb.length).toBeLessThan(MAX_IMPORT_BYTES);
    await expect(readProjectFile(fileOf(bomb, 'bomb.zip'))).rejects.toMatchObject({
      code: 'too-big',
    });
  });

  it.each([
    ['broken JSON', fileOf('{"blocks": ', 'a.json'), 'unreadable'],
    ['JSON that is not a workspace', fileOf('{"hello": 1}', 'a.json'), 'not-a-project'],
    ['an array', fileOf('[1, 2]', 'a.json'), 'not-a-project'],
    [
      'unknown block types',
      fileOf(JSON.stringify({ blocks: { blocks: [{ type: 'nope' }] } }), 'a.json'),
      'not-a-project',
    ],
    [
      'a zip without workspace.json',
      fileOf(zipSync({ 'a.txt': strToU8('hi') }), 'a.zip'),
      'not-a-project',
    ],
    [
      'a truncated zip',
      fileOf(zipSync({ 'a/workspace.json': strToU8('{}') }).slice(0, 20), 'a.zip'),
      'unreadable',
    ],
  ])('rejects %s', async (_label, file, code) => {
    const error = await readProjectFile(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ code });
  });
});

describe('isLoadableWorkspace', () => {
  it('accepts an empty workspace and our blocks', () => {
    expect(isLoadableWorkspace({})).toBe(true);
    expect(isLoadableWorkspace(LED_WORKSPACE)).toBe(true);
    expect(isLoadableWorkspace(null)).toBe(false);
  });
});
