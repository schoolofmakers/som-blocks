/** Current shape of a stored project. Bump with a Dexie upgrade in db.ts when it changes. */
export const PROJECT_SCHEMA_VERSION = 1;

export interface Project {
  /** Random UUID (crypto.randomUUID). */
  id: string;
  name: string;
  /** Board registry id (src/boards/registry.ts). */
  boardId: string;
  /** Blockly serialization JSON (`Blockly.serialization.workspaces.save`). */
  workspace: unknown;
  createdAt: number;
  updatedAt: number;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
}

/** What the recent-projects list needs; the workspace stays in the database. */
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updatedAt' | 'boardId'>;

export function toSummary({ id, name, updatedAt, boardId }: Project): ProjectSummary {
  return { id, name, updatedAt, boardId };
}
