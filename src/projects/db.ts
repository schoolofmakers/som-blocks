import Dexie, { type Table } from 'dexie';
import { toPairing } from '../wifi/pairing';
import { PROJECT_SCHEMA_VERSION, toSummary, type Project, type ProjectSummary } from './types';

// Pattern: a Dexie subclass declaring its tables, one `version(n).stores()` per schema
// (gong-io/gecko app/geckoModule/services/dataBaseService.js uses the same versioned
// `stores()` layout). Ours adds a read-side migration and an in-memory fallback.

export const DB_NAME = 'som-blocks';

export class SomBlocksDb extends Dexie {
  // `declare`, not a class field: with useDefineForClassFields a field initialiser would
  // overwrite the table Dexie attaches in the constructor.
  declare projects: Table<Project, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({ projects: 'id, updatedAt, name' });
    // Schema v2 goes here, e.g.:
    // this.version(2).stores({ ... }).upgrade((tx) =>
    //   tx.table('projects').toCollection().modify((record) => { ... }));
  }
}

/**
 * Migration hook for stored records. v1 is the only schema, so this only checks the shape;
 * a future schema upgrades older records here (and in a Dexie `upgrade()`). Returns null
 * for a record that cannot be read as a project, which callers keep untouched.
 */
export function migrateProject(record: unknown): Project | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Partial<Project>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  if (typeof r.boardId !== 'string') return null;
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : 0;
  // A malformed pairing is dropped (the student pairs again), never half-kept.
  const wifi = r.wifi === undefined ? null : toPairing(r.wifi);
  return {
    id: r.id,
    name: r.name,
    boardId: r.boardId,
    workspace: r.workspace ?? {},
    createdAt,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : createdAt,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...(wifi ? { wifi } : {}),
    ...(r.uploadOverWifi === true ? { uploadOverWifi: true } : {}),
  };
}

/** Where projects live: IndexedDB normally, memory when the browser blocks IndexedDB. */
export interface ProjectRepo {
  readonly kind: 'indexeddb' | 'memory';
  /** Every readable project, most recently updated first. */
  list(): Promise<ProjectSummary[]>;
  /** The project, `null` when the record exists but is unreadable, `undefined` if absent. */
  get(id: string): Promise<Project | null | undefined>;
  put(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

function sortSummaries(records: unknown[]): ProjectSummary[] {
  return records
    .map(migrateProject)
    .filter((p): p is Project => p !== null)
    .map(toSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export class DexieProjectRepo implements ProjectRepo {
  readonly kind = 'indexeddb';
  private readonly db: SomBlocksDb;

  constructor(db: SomBlocksDb) {
    this.db = db;
  }

  async list() {
    return sortSummaries(await this.db.projects.toArray());
  }

  async get(id: string) {
    const record = await this.db.projects.get(id);
    return record === undefined ? undefined : migrateProject(record);
  }

  async put(project: Project) {
    await this.db.projects.put(project);
  }

  async remove(id: string) {
    await this.db.projects.delete(id);
  }

  close() {
    this.db.close();
  }
}

export class MemoryProjectRepo implements ProjectRepo {
  readonly kind = 'memory';
  private readonly records = new Map<string, Project>();

  async list() {
    return sortSummaries([...this.records.values()]);
  }

  async get(id: string) {
    const record = this.records.get(id);
    return record === undefined ? undefined : migrateProject(structuredClone(record));
  }

  async put(project: Project) {
    this.records.set(project.id, structuredClone(project));
  }

  async remove(id: string) {
    this.records.delete(id);
  }
}

/**
 * Open the IndexedDB store, or fall back to memory when IndexedDB is missing or refuses to
 * open (Firefox private browsing / strict ETP, Safari with site data blocked). The editor
 * keeps working either way; the UI tells the student their work is not being kept.
 */
export async function openProjectRepo(name: string = DB_NAME): Promise<ProjectRepo> {
  try {
    // Inside the try: some browsers throw on merely touching `indexedDB` when it's blocked.
    if (typeof indexedDB === 'undefined') return new MemoryProjectRepo();
    const db = new SomBlocksDb(name);
    await db.open();
    return new DexieProjectRepo(db);
  } catch {
    return new MemoryProjectRepo();
  }
}
