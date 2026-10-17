import type { BuildRecord, DeviceRecord, SerialLine } from './types.js';

/**
 * Where the relay keeps device records, builds, the serial ring and queued input.
 *
 * Synchronous on purpose: the relay runs on one machine, handlers stay free of interleaving
 * between a read and a write, and the persistent replacement we would reach for (SQLite via
 * a synchronous driver, or a write-through cache in front of anything else) fits the same
 * shape. TTL expiry is driven by the relay's sweep, not by the store.
 */
export interface Store {
  getDevice(id: string): DeviceRecord | undefined;
  putDevice(device: DeviceRecord): void;
  /** Removes the device and everything hanging off it (builds, serial ring, input queue). */
  deleteDevice(id: string): void;
  listDevices(): DeviceRecord[];

  getBuild(id: string): BuildRecord | undefined;
  putBuild(build: BuildRecord): void;
  deleteBuild(id: string): void;
  listBuilds(): BuildRecord[];
  /** Bytes of images still held in memory (queued or in-progress builds). */
  imageBytes(): number;

  /** Appends lines to the device's ring (oldest dropped past the cap); returns the last seq. */
  appendSerial(deviceId: string, lines: string[]): number;
  /** Lines with `seq > after`, oldest first. */
  serialSince(deviceId: string, after: number): SerialLine[];

  /** Queues a line typed in the monitor (oldest dropped past the cap). */
  pushInput(deviceId: string, line: string): void;
  /** Returns and clears the device's queued input. */
  drainInput(deviceId: string): string[];
}

export interface MemoryStoreOptions {
  serialRingLines: number;
  inputQueueLines: number;
}

export class MemoryStore implements Store {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly builds = new Map<string, BuildRecord>();
  private readonly serial = new Map<string, { nextSeq: number; lines: SerialLine[] }>();
  private readonly input = new Map<string, string[]>();
  private readonly opts: MemoryStoreOptions;

  constructor(opts: MemoryStoreOptions) {
    this.opts = opts;
  }

  getDevice(id: string) {
    return this.devices.get(id);
  }

  putDevice(device: DeviceRecord) {
    this.devices.set(device.id, device);
  }

  deleteDevice(id: string) {
    this.devices.delete(id);
    this.serial.delete(id);
    this.input.delete(id);
    for (const build of this.builds.values()) {
      if (build.deviceId === id) this.builds.delete(build.id);
    }
  }

  listDevices() {
    return [...this.devices.values()];
  }

  getBuild(id: string) {
    return this.builds.get(id);
  }

  putBuild(build: BuildRecord) {
    this.builds.set(build.id, build);
  }

  deleteBuild(id: string) {
    this.builds.delete(id);
  }

  listBuilds() {
    return [...this.builds.values()];
  }

  imageBytes() {
    let total = 0;
    for (const build of this.builds.values()) total += build.image?.length ?? 0;
    return total;
  }

  appendSerial(deviceId: string, lines: string[]) {
    let ring = this.serial.get(deviceId);
    if (!ring) {
      ring = { nextSeq: 1, lines: [] };
      this.serial.set(deviceId, ring);
    }
    for (const line of lines) ring.lines.push({ seq: ring.nextSeq++, line });
    const overflow = ring.lines.length - this.opts.serialRingLines;
    if (overflow > 0) ring.lines.splice(0, overflow);
    return ring.nextSeq - 1;
  }

  serialSince(deviceId: string, after: number) {
    const ring = this.serial.get(deviceId);
    return ring ? ring.lines.filter((l) => l.seq > after) : [];
  }

  pushInput(deviceId: string, line: string) {
    let queue = this.input.get(deviceId);
    if (!queue) {
      queue = [];
      this.input.set(deviceId, queue);
    }
    queue.push(line);
    const overflow = queue.length - this.opts.inputQueueLines;
    if (overflow > 0) queue.splice(0, overflow);
  }

  drainInput(deviceId: string) {
    const queue = this.input.get(deviceId) ?? [];
    this.input.delete(deviceId);
    return queue;
  }
}
