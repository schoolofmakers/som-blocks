import type { WifiPairing } from '../wifi/pairing';

/**
 * Current shape of a stored project. Bump with a Dexie upgrade in db.ts when it changes.
 * Optional fields added later (`wifi`, `uploadOverWifi`) need no bump: they are not indexed
 * and an older record simply lacks them.
 */
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
  /** The board this project uploads to over WiFi (Track D). Never exported or duplicated. */
  wifi?: WifiPairing;
  /** "Sube por WiFi": compile with the board's OTA options and link SomLink. */
  uploadOverWifi?: boolean;
}

/** What the recent-projects list needs; the workspace stays in the database. */
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'updatedAt' | 'boardId'>;

export function toSummary({ id, name, updatedAt, boardId }: Project): ProjectSummary {
  return { id, name, updatedAt, boardId };
}
