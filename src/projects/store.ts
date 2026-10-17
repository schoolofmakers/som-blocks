import { create } from 'zustand';
import { DEFAULT_BOARD_ID, isBoardId } from '../boards/registry';
import { useBoardStore } from '../boards/store';
import {
  buildProjectZip,
  downloadFile,
  generateSketch,
  ImportError,
  readProjectFile,
  type ImportErrorCode,
} from './archive';
import { MemoryProjectRepo, openProjectRepo, type ProjectRepo } from './db';
import { PROJECT_SCHEMA_VERSION, toSummary, type Project, type ProjectSummary } from './types';

export const CURRENT_PROJECT_STORAGE_KEY = 'som.currentProjectId';
export const AUTOSAVE_DELAY_MS = 500;
export const MAX_RECENT_PROJECTS = 20;
const FALLBACK_PROJECT_NAME = 'Mi proyecto';

export type ProjectNotice =
  | { kind: 'corrupt'; name: string }
  | { kind: 'unknown-board'; name: string; boardId: string }
  | { kind: 'import-failed'; code: ImportErrorCode }
  | { kind: 'save-failed' }
  | { kind: 'export-failed' };

/** What the editor must load: a new `key` means "replace the workspace with `state`". */
export interface EditorLoad {
  key: string;
  state: unknown;
}

export interface ProjectsState {
  status: 'loading' | 'ready';
  /** `memory` when IndexedDB is unavailable: work lasts until the tab closes. */
  storage: 'indexeddb' | 'memory';
  currentProjectId: string | null;
  /** The open project, with the latest (maybe not yet written) workspace. */
  current: Project | null;
  editorLoad: EditorLoad | null;
  /** Every project, most recently updated first. */
  projects: ProjectSummary[];
  notice: ProjectNotice | null;

  init: (options?: { repo?: ProjectRepo; defaultName?: string }) => Promise<void>;
  create: (name?: string) => Promise<void>;
  open: (id: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Autosave: written after {@link AUTOSAVE_DELAY_MS} of quiet, or at once by `flush`. */
  saveWorkspace: (workspace: unknown) => void;
  flush: () => Promise<void>;
  exportZip: (id: string) => Promise<void>;
  importFile: (file: File) => Promise<void>;
  /** The editor could not load the open project's workspace. */
  workspaceLoadFailed: () => Promise<void>;
  dismissNotice: () => void;
}

// Module state that never needs to re-render anything.
let repo: ProjectRepo = new MemoryProjectRepo();
let initPromise: Promise<void> | null = null;
let defaultName = FALLBACK_PROJECT_NAME;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let loadCounter = 0;
/** Project being deleted: autosave must not write it back while the delete is in flight. */
let deletingId: string | null = null;
/** Last written workspace JSON per project, so an unchanged workspace is not rewritten. */
const lastWritten = new Map<string, string>();
/**
 * Projects whose last write failed (quota, storage error). Reads prefer these copies, so
 * switching away from a project that could not be saved never loses its blocks during the
 * session; reopening it retries the write.
 */
const unsaved = new Map<string, Project>();

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context; a school LAN over plain http may not be one.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `name`, or `name (2)`, `name (3)`… when another project already has it. */
export function uniqueName(name: string, projects: readonly ProjectSummary[]): string {
  const taken = new Set(projects.map((p) => p.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

// Guarded like the board store's safeLocalStorage: blocked storage (private mode, site data
// off) just means the app opens the most recent project on the next visit.
function readStoredProjectId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeProjectId(id: string): void {
  try {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, id);
  } catch {
    // Not persisted; fine.
  }
}

function clearAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function onPageHidden(): void {
  if (document.visibilityState === 'hidden') void useProjectsStore.getState().flush();
}

function onBlur(): void {
  void useProjectsStore.getState().flush();
}

let listenersAttached = false;
function attachFlushListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  document.addEventListener('visibilitychange', onPageHidden);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onBlur);
}

export const useProjectsStore = create<ProjectsState>()((set, get) => {
  function upsertSummary(project: Project): void {
    const others = get().projects.filter((p) => p.id !== project.id);
    set({
      projects: [toSummary(project), ...others].sort((a, b) => b.updatedAt - a.updatedAt),
    });
  }

  /** Write a project; on failure keep working in memory and tell the student. */
  async function write(project: Project): Promise<boolean> {
    try {
      await repo.put(project);
      unsaved.delete(project.id);
      lastWritten.set(project.id, JSON.stringify(project.workspace));
      upsertSummary(project);
      return true;
    } catch {
      unsaved.set(project.id, project);
      upsertSummary(project);
      set({ notice: { kind: 'save-failed' } });
      return false;
    }
  }

  /** Make `project` the open one and tell the editor and the board picker. */
  function activate(project: Project): void {
    const boardId = isBoardId(project.boardId) ? project.boardId : DEFAULT_BOARD_ID;
    const opened = { ...project, boardId };
    // Edits made while the switch awaited IndexedDB belong to the outgoing project: write
    // them before it is replaced (a failure lands in `unsaved`, so nothing is lost).
    const outgoing = get().current;
    if (dirty && outgoing && outgoing.id !== opened.id) {
      clearAutosave();
      void write({ ...outgoing, updatedAt: Date.now() });
    }
    dirty = false;
    loadCounter += 1;
    lastWritten.set(opened.id, JSON.stringify(opened.workspace));
    // `current` first: the board subscription below then sees no change to write back.
    set({
      current: opened,
      currentProjectId: opened.id,
      editorLoad: { key: `${opened.id}:${loadCounter}`, state: opened.workspace },
    });
    storeProjectId(opened.id);
    useBoardStore.getState().setBoard(boardId);
    if (unsaved.has(opened.id)) {
      // Its last write failed: the next flush tries again.
      lastWritten.delete(opened.id);
      dirty = true;
    }
  }

  /** The stored project, preferring a copy whose write failed this session. */
  async function readProject(id: string): Promise<Project | null | undefined> {
    return unsaved.get(id) ?? repo.get(id);
  }

  /** Create, store and open a project; false when it could only be kept in memory. */
  async function createProject(
    name: string,
    workspace: unknown,
    boardId: string,
  ): Promise<boolean> {
    const now = Date.now();
    const project: Project = {
      id: newId(),
      name: uniqueName(name, get().projects),
      boardId,
      workspace,
      createdAt: now,
      updatedAt: now,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    };
    const stored = await write(project);
    activate(project);
    return stored;
  }

  async function projectById(id: string): Promise<Project | null | undefined> {
    const { current } = get();
    if (current?.id === id) return current;
    return readProject(id);
  }

  async function openMostRecentOrCreate(): Promise<void> {
    for (const summary of get().projects) {
      if (await get().open(summary.id)) return;
    }
    await createProject(defaultName, {}, useBoardStore.getState().boardId);
  }

  async function load(options: { repo?: ProjectRepo; defaultName?: string }): Promise<void> {
    if (options.defaultName) defaultName = options.defaultName;
    try {
      repo = options.repo ?? (await openProjectRepo());
      set({ storage: repo.kind, projects: await repo.list() });
      const storedId = readStoredProjectId();
      if (!(storedId && (await get().open(storedId)))) await openMostRecentOrCreate();
    } catch {
      // IndexedDB opened but then failed (quota, corrupted store): stay usable in memory.
      repo = new MemoryProjectRepo();
      set({ storage: 'memory', projects: [] });
      await createProject(defaultName, {}, useBoardStore.getState().boardId);
    }
    attachFlushListeners();
    set({ status: 'ready' });
  }

  return {
    status: 'loading',
    storage: 'indexeddb',
    currentProjectId: null,
    current: null,
    editorLoad: null,
    projects: [],
    notice: null,

    init: (options = {}) => {
      initPromise ??= load(options);
      return initPromise;
    },

    create: async (name) => {
      await get().flush();
      await createProject(name?.trim() || defaultName, {}, useBoardStore.getState().boardId);
    },

    open: async (id) => {
      await get().flush();
      let project: Project | null | undefined;
      try {
        project = await readProject(id);
      } catch {
        project = null;
      }
      if (!project) {
        // Unreadable record: leave it in the database, untouched.
        if (project === null) {
          const name = get().projects.find((p) => p.id === id)?.name ?? '';
          set({ notice: { kind: 'corrupt', name } });
        }
        return false;
      }
      activate(project);
      return true;
    },

    rename: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const project = await projectById(id);
      if (!project || project.name === trimmed) return;
      const renamed = { ...project, name: trimmed, updatedAt: Date.now() };
      if (get().current?.id === id) {
        clearAutosave();
        dirty = false;
        set({ current: renamed });
      }
      await write(renamed);
    },

    duplicate: async (id) => {
      await get().flush();
      const source = await projectById(id);
      if (!source) return;
      await createProject(source.name, structuredClone(source.workspace), source.boardId);
    },

    remove: async (id) => {
      const wasCurrent = get().currentProjectId === id;
      if (!wasCurrent) await get().flush();
      // Pause saves of this project while it is deleted (a put queued after the delete
      // would bring it back); resume them if the delete fails.
      deletingId = id;
      clearAutosave();
      try {
        await repo.remove(id);
      } catch {
        deletingId = null;
        if (dirty) autosaveTimer = setTimeout(() => void get().flush(), AUTOSAVE_DELAY_MS);
        set({ notice: { kind: 'save-failed' } });
        return;
      }
      deletingId = null;
      if (get().currentProjectId === id) dirty = false;
      lastWritten.delete(id);
      unsaved.delete(id);
      set({ projects: get().projects.filter((p) => p.id !== id) });
      if (wasCurrent) {
        set({ current: null, currentProjectId: null });
        await openMostRecentOrCreate();
      }
    },

    saveWorkspace: (workspace) => {
      const { current } = get();
      if (!current) return;
      set({ current: { ...current, workspace } });
      dirty = true;
      clearAutosave();
      autosaveTimer = setTimeout(() => void get().flush(), AUTOSAVE_DELAY_MS);
    },

    flush: async () => {
      clearAutosave();
      if (!dirty) return;
      const { current } = get();
      if (!current || current.id === deletingId) return;
      dirty = false;
      if (JSON.stringify(current.workspace) === lastWritten.get(current.id)) return;
      const saved = { ...current, updatedAt: Date.now() };
      if (get().current?.id === saved.id) set({ current: saved });
      if (!(await write(saved))) dirty = true;
    },

    exportZip: async (id) => {
      await get().flush();
      try {
        const project = await projectById(id);
        if (!project) throw new Error(`No project ${id}`);
        const code = generateSketch(project.workspace, project.boardId);
        const { filename, bytes } = buildProjectZip(project, code);
        downloadFile(bytes, filename);
      } catch {
        set({ notice: { kind: 'export-failed' } });
      }
    },

    importFile: async (file) => {
      let imported;
      try {
        imported = await readProjectFile(file);
      } catch (error) {
        const code = error instanceof ImportError ? error.code : 'unreadable';
        set({ notice: { kind: 'import-failed', code } });
        return;
      }
      await get().flush();
      // A bare workspace .json names no board: keep the one the student is using. A board
      // this build doesn't know (removed, or from a newer build) falls back to the default.
      const requested = imported.boardId;
      const unknownBoard = requested !== null && !isBoardId(requested);
      const boardId =
        requested === null
          ? useBoardStore.getState().boardId
          : unknownBoard
            ? DEFAULT_BOARD_ID
            : requested;
      const stored = await createProject(imported.name, imported.workspace, boardId);
      // Not stored: keep the save warning, the import only lives in this tab.
      if (!stored) return;
      const name = get().current?.name ?? imported.name;
      set({
        notice: unknownBoard ? { kind: 'unknown-board', name, boardId: requested } : null,
      });
    },

    workspaceLoadFailed: async () => {
      const bad = get().current;
      // Never write the editor's (empty) state over the record that failed to load.
      clearAutosave();
      dirty = false;
      await createProject(defaultName, {}, bad?.boardId ?? useBoardStore.getState().boardId);
      set({ notice: { kind: 'corrupt', name: bad?.name ?? '' } });
    },

    dismissNotice: () => set({ notice: null }),
  };
});

// Board picker → open project. Opening a project sets the board itself (see `activate`).
useBoardStore.subscribe((state, previous) => {
  if (state.boardId === previous.boardId) return;
  const { current, flush } = useProjectsStore.getState();
  if (!current || current.boardId === state.boardId) return;
  useProjectsStore.setState({ current: { ...current, boardId: state.boardId } });
  dirty = true;
  // Force a write even though the workspace JSON is unchanged.
  lastWritten.delete(current.id);
  void flush();
});

/** Test helper: forget everything (the store is a module singleton). */
export function resetProjectsStore(): void {
  clearAutosave();
  dirty = false;
  deletingId = null;
  initPromise = null;
  defaultName = FALLBACK_PROJECT_NAME;
  lastWritten.clear();
  unsaved.clear();
  repo = new MemoryProjectRepo();
  useProjectsStore.setState({
    status: 'loading',
    storage: 'indexeddb',
    currentProjectId: null,
    current: null,
    editorLoad: null,
    projects: [],
    notice: null,
  });
}
