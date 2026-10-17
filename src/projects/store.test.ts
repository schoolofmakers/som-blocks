import 'fake-indexeddb/auto';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOARD_ID } from '../boards/registry';
import { useBoardStore } from '../boards/store';
import { buildProjectZip, generateSketch } from './archive';
import {
  MemoryProjectRepo,
  migrateProject,
  openProjectRepo,
  SomBlocksDb,
  type ProjectRepo,
} from './db';
import {
  AUTOSAVE_DELAY_MS,
  CURRENT_PROJECT_STORAGE_KEY,
  resetProjectsStore,
  uniqueName,
  useProjectsStore,
} from './store';
import { PROJECT_SCHEMA_VERSION, type Project } from './types';

const RAW = (code: string) => ({
  blocks: {
    languageVersion: 0,
    blocks: [{ type: 'som_raw_statement', x: 0, y: 0, fields: { CODE: code } }],
  },
});

let dbCount = 0;
let dbName = '';

const state = () => useProjectsStore.getState();

/** A fresh, isolated IndexedDB (fake-indexeddb) per test. */
async function freshRepo(): Promise<ProjectRepo> {
  dbCount += 1;
  dbName = `som-blocks-test-${dbCount}`;
  return openProjectRepo(dbName);
}

/** Simulate a reload: forget the in-memory store, reopen the same database. */
async function reload(): Promise<void> {
  resetProjectsStore();
  await state().init({ repo: await openProjectRepo(dbName) });
}

async function stored(id: string): Promise<Project | undefined> {
  const db = new SomBlocksDb(dbName);
  try {
    return await db.projects.get(id);
  } finally {
    db.close();
  }
}

function record(overrides: Partial<Project>): Project {
  return {
    id: 'seed',
    name: 'Seed',
    boardId: 'uno',
    workspace: {},
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...overrides,
  };
}

describe('projects store', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    useBoardStore.setState({ boardId: DEFAULT_BOARD_ID });
    resetProjectsStore();
    await state().init({ repo: await freshRepo() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates "Mi proyecto" on the C3 on first launch and remembers it', async () => {
    const { current, projects, storage } = state();
    expect(storage).toBe('indexeddb');
    expect(current).toMatchObject({ name: 'Mi proyecto', boardId: 'esp32c3-supermini' });
    expect(projects).toHaveLength(1);
    expect(window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY)).toBe(current?.id);
    expect(await stored(current!.id)).toMatchObject({ name: 'Mi proyecto', schemaVersion: 1 });
    expect(state().editorLoad).toEqual({ key: expect.any(String), state: {} });
  });

  it('reopens the remembered project after a reload, not just the newest', async () => {
    const first = state().current!.id;
    await state().create('Segundo');
    await state().open(first);
    await reload();
    expect(state().current?.id).toBe(first);
    expect(
      state()
        .projects.map((p) => p.name)
        .sort(),
    ).toEqual(['Mi proyecto', 'Segundo']);
  });

  it('creates, renames, duplicates and deletes', async () => {
    await state().create();
    expect(state().current?.name).toBe('Mi proyecto (2)');

    const id = state().current!.id;
    await state().rename(id, '  Semáforo  ');
    expect(state().current?.name).toBe('Semáforo');
    expect((await stored(id))?.name).toBe('Semáforo');
    await state().rename(id, '   '); // blank names are ignored
    expect(state().current?.name).toBe('Semáforo');

    state().saveWorkspace(RAW('blink();'));
    await state().duplicate(id);
    const copy = state().current!;
    expect(copy.id).not.toBe(id);
    expect(copy.name).toBe('Semáforo (2)');
    expect(copy.workspace).toEqual(RAW('blink();'));
    // Duplicating flushed the original's pending autosave first.
    expect((await stored(id))?.workspace).toEqual(RAW('blink();'));

    await state().remove(copy.id);
    expect(await stored(copy.id)).toBeUndefined();
    expect(state().projects.map((p) => p.name)).not.toContain('Semáforo (2)');
    // Deleting the open project opens the most recent remaining one.
    expect(state().current?.id).toBe(id);
  });

  it('deleting the last project creates a fresh one', async () => {
    await state().remove(state().current!.id);
    expect(state().projects).toHaveLength(1);
    expect(state().current?.name).toBe('Mi proyecto');
  });

  it('autosaves 500 ms after the last change, once', async () => {
    const id = state().current!.id;
    const put = vi.spyOn(MemoryProjectRepo.prototype, 'put');
    resetProjectsStore();
    const memory = new MemoryProjectRepo();
    await state().init({ repo: memory });
    put.mockClear();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    state().saveWorkspace(RAW('a();'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    state().saveWorkspace(RAW('b();'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0].workspace).toEqual(RAW('b();'));
    expect(id).toBeTruthy();
  });

  it('writes at once on flush (blur / page hidden) and skips unchanged workspaces', async () => {
    const id = state().current!.id;
    state().saveWorkspace(RAW('now();'));
    window.dispatchEvent(new Event('blur'));
    await vi.waitFor(async () => expect((await stored(id))?.workspace).toEqual(RAW('now();')));
    const updatedAt = (await stored(id))!.updatedAt;

    state().saveWorkspace(RAW('now();'));
    await state().flush();
    expect((await stored(id))?.updatedAt).toBe(updatedAt);
  });

  it('keeps the autosaved blocks across a reload', async () => {
    const id = state().current!.id;
    state().saveWorkspace(RAW('persist();'));
    await state().flush();
    await reload();
    expect(state().current?.id).toBe(id);
    expect(state().editorLoad?.state).toEqual(RAW('persist();'));
  });

  it('writes board changes into the open project and sets the board when opening', async () => {
    const first = state().current!.id;
    useBoardStore.getState().setBoard('uno');
    await vi.waitFor(async () => expect((await stored(first))?.boardId).toBe('uno'));
    expect(state().current?.boardId).toBe('uno');

    await state().create('Nano');
    useBoardStore.getState().setBoard('nano-old');
    await vi.waitFor(async () =>
      expect((await stored(state().current!.id))?.boardId).toBe('nano-old'),
    );

    await state().open(first);
    expect(useBoardStore.getState().boardId).toBe('uno');
    expect((await stored(first))?.boardId).toBe('uno');
  });

  it('opens a project whose board no longer exists on the default board', async () => {
    const repo = await openProjectRepo(dbName);
    await repo.put(record({ id: 'old', boardId: 'retired-board', updatedAt: Date.now() + 1 }));
    expect(await state().open('old')).toBe(true);
    expect(state().current?.boardId).toBe(DEFAULT_BOARD_ID);
    expect(useBoardStore.getState().boardId).toBe(DEFAULT_BOARD_ID);
  });

  it('a workspace that fails to load opens an empty project and keeps the bad record', async () => {
    const repo = await openProjectRepo(dbName);
    const bad = record({ id: 'bad', name: 'Roto', workspace: { blocks: 'garbage' } });
    await repo.put(bad);
    await state().open('bad');
    await state().workspaceLoadFailed();

    expect(state().current?.id).not.toBe('bad');
    expect(state().current?.workspace).toEqual({});
    expect(state().notice).toEqual({ kind: 'corrupt', name: 'Roto' });
    expect(await stored('bad')).toEqual(bad);
  });

  it('an unreadable record is skipped at startup and left in the database', async () => {
    const db = new SomBlocksDb(dbName);
    await db.projects.put({ id: 'broken', name: 42 } as unknown as Project);
    db.close();
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, 'broken');
    await reload();
    expect(state().current?.id).not.toBe('broken');
    expect(state().notice).toEqual({ kind: 'corrupt', name: '' });
    expect(await stored('broken')).toEqual({ id: 'broken', name: 42 });
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      const repo = await openProjectRepo('whatever');
      expect(repo.kind).toBe('memory');
      resetProjectsStore();
      await state().init({ repo });
      expect(state().storage).toBe('memory');
      expect(state().current?.name).toBe('Mi proyecto');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to memory when IndexedDB fails after opening', async () => {
    const broken: ProjectRepo = {
      kind: 'indexeddb',
      list: () => Promise.reject(new Error('quota')),
      get: () => Promise.reject(new Error('quota')),
      put: () => Promise.reject(new Error('quota')),
      remove: () => Promise.reject(new Error('quota')),
    };
    resetProjectsStore();
    await state().init({ repo: broken });
    expect(state().status).toBe('ready');
    expect(state().storage).toBe('memory');
    expect(state().current?.name).toBe('Mi proyecto');
  });

  it('a failed save keeps the blocks when switching away and back, and retries', async () => {
    const memory = new MemoryProjectRepo();
    resetProjectsStore();
    await state().init({ repo: memory });
    const first = state().current!.id;
    await state().create('Otro');
    const second = state().current!.id;
    await state().open(first);

    const put = vi.spyOn(memory, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));
    state().saveWorkspace(RAW('unsaved();'));
    await state().open(second); // its flush fails
    expect(state().notice).toEqual({ kind: 'save-failed' });
    expect(state().current?.id).toBe(second);

    await state().open(first);
    expect(state().editorLoad?.state).toEqual(RAW('unsaved();'));
    await state().flush(); // retried now that storage works again
    expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ workspace: RAW('unsaved();') }));
    expect((await memory.get(first))?.workspace).toEqual(RAW('unsaved();'));
  });

  it('an edit made while a switch awaits IndexedDB is saved to the outgoing project', async () => {
    const first = state().current!.id;
    await state().create('Otro');
    const second = state().current!.id;
    await state().open(first);

    const opening = state().open(second); // flush done, now awaiting the read
    state().saveWorkspace(RAW('late();'));
    await opening;
    expect(state().current?.id).toBe(second);
    await vi.waitFor(async () => expect((await stored(first))?.workspace).toEqual(RAW('late();')));
    expect((await stored(second))?.workspace).toEqual({});
  });

  it('a failed delete keeps the pending autosave', async () => {
    const memory = new MemoryProjectRepo();
    resetProjectsStore();
    await state().init({ repo: memory });
    const id = state().current!.id;
    vi.spyOn(memory, 'remove').mockRejectedValueOnce(new Error('blocked'));
    state().saveWorkspace(RAW('keep();'));
    await state().remove(id);
    expect(state().notice).toEqual({ kind: 'save-failed' });
    await state().flush();
    expect((await memory.get(id))?.workspace).toEqual(RAW('keep();'));
  });

  it('autosave never writes a project back while it is being deleted', async () => {
    const memory = new MemoryProjectRepo();
    resetProjectsStore();
    await state().init({ repo: memory });
    const id = state().current!.id;
    let finishDelete = () => {};
    const realRemove = memory.remove.bind(memory);
    vi.spyOn(memory, 'remove').mockImplementationOnce(
      (target) =>
        new Promise<void>((resolve) => {
          finishDelete = () => void realRemove(target).then(resolve);
        }),
    );
    const put = vi.spyOn(memory, 'put');

    state().saveWorkspace(RAW('pending();'));
    const removing = state().remove(id);
    state().saveWorkspace(RAW('during();')); // an edit while the delete is in flight
    await state().flush();
    expect(put).not.toHaveBeenCalledWith(expect.objectContaining({ id }));
    finishDelete();
    await removing;
    await state().flush();
    expect(await memory.get(id)).toBeUndefined();
    expect(state().current?.id).not.toBe(id);
  });

  it('an import that cannot be stored keeps the save warning', async () => {
    vi.spyOn(MemoryProjectRepo.prototype, 'put').mockRejectedValue(new Error('quota'));
    resetProjectsStore();
    await state().init({ repo: new MemoryProjectRepo() });
    await state().importFile(new File([JSON.stringify(RAW('z();'))], 'robot.json'));
    expect(state().current?.name).toBe('robot');
    expect(state().notice).toEqual({ kind: 'save-failed' });
  });

  it('exports a zip whose .ino is the generator output for the project board', async () => {
    useBoardStore.getState().setBoard('uno');
    state().saveWorkspace(RAW('blink();'));
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return 'blob:zip';
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await state().rename(state().current!.id, 'Luces');
    await state().exportZip(state().current!.id);

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('Luces.zip');
    const blob = createObjectURL.mock.calls[0]![0];
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const ino = strFromU8(files['Luces/Luces.ino']!);
    expect(ino).toBe(generateSketch(RAW('blink();'), 'uno'));
    expect(ino).toContain('blink();');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['Luces/workspace.json', 'Luces/project.json']),
    );
    vi.unstubAllGlobals();
  });

  it('imports our zip with " (2)" on a name collision', async () => {
    const zip = buildProjectZip(
      record({ name: 'Mi proyecto', boardId: 'nano-old', workspace: RAW('x();') }),
      '',
    );
    await state().importFile(new File([zip.bytes as Uint8Array<ArrayBuffer>], zip.filename));
    expect(state().current).toMatchObject({
      name: 'Mi proyecto (2)',
      boardId: 'nano-old',
      workspace: RAW('x();'),
    });
    expect(useBoardStore.getState().boardId).toBe('nano-old');
    expect(state().editorLoad?.state).toEqual(RAW('x();'));
    expect(state().notice).toBeNull();
  });

  it('imports a bare workspace .json on the current board', async () => {
    useBoardStore.getState().setBoard('uno');
    await state().importFile(new File([JSON.stringify(RAW('y();'))], 'robot.json'));
    expect(state().current).toMatchObject({ name: 'robot', boardId: 'uno' });
  });

  it('imports a zip for an unknown board on the default board and says so', async () => {
    const zip = buildProjectZip(record({ name: 'Futuro', boardId: 'esp32-s9' }), '');
    await state().importFile(new File([zip.bytes as Uint8Array<ArrayBuffer>], zip.filename));
    expect(state().current).toMatchObject({ name: 'Futuro', boardId: DEFAULT_BOARD_ID });
    expect(state().notice).toEqual({ kind: 'unknown-board', name: 'Futuro', boardId: 'esp32-s9' });
  });

  it('reports an import it cannot read and keeps the open project', async () => {
    const before = state().current?.id;
    await state().importFile(new File(['not json'], 'x.json'));
    expect(state().notice).toEqual({ kind: 'import-failed', code: 'unreadable' });
    expect(state().current?.id).toBe(before);
  });
});

describe('projects store: WiFi pairing and "sube por WiFi"', () => {
  const PAIRING = {
    deviceId: 'fa4e00c3c3c3',
    token: 'ab'.repeat(32),
    name: 'Azul',
    relayUrl: 'http://relay.test',
  };

  beforeEach(async () => {
    window.localStorage.clear();
    useBoardStore.setState({ boardId: DEFAULT_BOARD_ID });
    resetProjectsStore();
    await state().init({ repo: await freshRepo() });
  });

  it('stores the pairing in the project record (IndexedDB), not in localStorage', async () => {
    const id = state().current!.id;
    await state().setPairing(PAIRING, { notify: true });
    expect(state().current?.wifi).toEqual(PAIRING);
    expect(state().notice).toEqual({ kind: 'paired', name: 'Azul' });
    expect((await stored(id))?.wifi).toEqual(PAIRING);
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)!;
      expect(window.localStorage.getItem(key)).not.toContain(PAIRING.token);
    }
    await reload();
    expect(state().current?.wifi).toEqual(PAIRING);
    await state().setPairing(null);
    expect(state().current?.wifi).toBeUndefined();
    expect((await stored(id))?.wifi).toBeUndefined();
  });

  it('keeps the flag per project and never copies the pairing into a duplicate', async () => {
    const id = state().current!.id;
    await state().setPairing(PAIRING);
    await state().setUploadOverWifi(true);
    expect((await stored(id))?.uploadOverWifi).toBe(true);
    await state().duplicate(id);
    expect(state().current?.id).not.toBe(id);
    expect(state().current?.wifi).toBeUndefined();
    expect(state().current?.uploadOverWifi).toBeUndefined();
    await state().open(id);
    await state().setUploadOverWifi(false);
    expect((await stored(id))?.uploadOverWifi).toBeUndefined();
  });

  it('drops a malformed stored pairing on read', () => {
    expect(migrateProject(record({ wifi: { ...PAIRING, token: 'x' } }))?.wifi).toBeUndefined();
    expect(migrateProject(record({ wifi: PAIRING, uploadOverWifi: true }))).toMatchObject({
      wifi: PAIRING,
      uploadOverWifi: true,
    });
  });
});

describe('uniqueName', () => {
  const s = (name: string) => ({ id: name, name, updatedAt: 0, boardId: 'uno' });
  it('adds the first free (n)', () => {
    expect(uniqueName('A', [])).toBe('A');
    expect(uniqueName('A', [s('A')])).toBe('A (2)');
    expect(uniqueName('A', [s('A'), s('A (2)')])).toBe('A (3)');
  });
});
