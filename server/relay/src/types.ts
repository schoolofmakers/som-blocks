// Records the relay keeps. Protocol v1: `_config/architecture.md` → "Track D" → "Relay service".

/** States a device reports through `POST /v1/devices/{id}/status`. */
export const DEVICE_BUILD_STATES = [
  'downloading',
  'flashing',
  'rebooting',
  'running',
  'failed',
] as const;
export type DeviceBuildState = (typeof DEVICE_BUILD_STATES)[number];

/** `queued` is the relay's own state between the editor's POST and the device's first status. */
export type BuildState = 'queued' | DeviceBuildState;

/** `running` = success, `failed` = failure; the editor stops following a build in either. */
export const TERMINAL_BUILD_STATES: readonly BuildState[] = ['running', 'failed'];

export interface DeviceRecord {
  id: string;
  /** sha256(bearer token). The raw token is never stored. */
  tokenHash: Buffer;
  fw: string;
  name: string;
  chip: string;
  createdAt: number;
  /** Last authenticated device call (register, next, status, serial, input). */
  lastSeen: number;
  /** Presence as last announced on the SSE stream (`online` / `offline` events). */
  announcedOnline: boolean;
  /** The build `next` hands out; cleared on the device's first status for it. */
  pendingBuildId: string | null;
}

export interface BuildRecord {
  id: string;
  deviceId: string;
  /** Dropped once the build reaches a terminal state, to free memory. */
  image: Buffer | null;
  size: number;
  sha256: string;
  state: BuildState;
  detail?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SerialLine {
  seq: number;
  line: string;
}

/** Events on `GET /v1/devices/{id}/events`. */
export type RelayEvent =
  | { event: 'online'; data: { lastSeen: number } }
  | { event: 'offline'; data: { lastSeen: number } }
  | { event: 'status'; data: { buildId: string; state: BuildState; detail?: string } }
  | { event: 'serial'; data: { lines: string[] }; id: number };
