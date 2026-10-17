import type { RelayEvent } from './types.js';

/** What a device long-poll waits for. */
export type WaitKind = 'build' | 'input';

/** Why a long-poll wait ended. Only `woken` means there may be something to deliver. */
export type WaitOutcome = 'woken' | 'timeout' | 'aborted' | 'superseded' | 'closed';

interface Waiter {
  finish(outcome: WaitOutcome): void;
}

export interface Subscriber {
  send(event: RelayEvent): void;
  /** Ends the SSE stream from the server side (device deleted or expired, shutdown). */
  close(): void;
}

/**
 * In-process wake-ups for device long-polls and fan-out to editor SSE streams.
 *
 * At most one waiter per device and kind: a new `next`/`input` poll from the same device
 * supersedes the previous one (which answers 204), so a board that reconnected while its old
 * TCP connection lingers cannot pile up handlers. Every waiter is released on its timer, on
 * the request's abort signal (client gone), on supersede or on `closeDevice` — whichever comes
 * first — and removes its timer and abort listener when it does.
 */
export class Hub {
  private readonly waiters = new Map<string, Waiter>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  wait(deviceId: string, kind: WaitKind, ms: number, signal?: AbortSignal): Promise<WaitOutcome> {
    const key = `${deviceId}:${kind}`;
    this.waiters.get(key)?.finish('superseded');
    if (signal?.aborted) return Promise.resolve('aborted');
    if (ms <= 0) return Promise.resolve('timeout');

    return new Promise<WaitOutcome>((resolve) => {
      const onAbort = () => waiter.finish('aborted');
      const timer = setTimeout(() => waiter.finish('timeout'), ms);
      const waiter: Waiter = {
        finish: (outcome) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (this.waiters.get(key) === waiter) this.waiters.delete(key);
          resolve(outcome);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(key, waiter);
    });
  }

  wake(deviceId: string, kind: WaitKind) {
    this.waiters.get(`${deviceId}:${kind}`)?.finish('woken');
  }

  subscribe(deviceId: string, sub: Subscriber): () => void {
    let set = this.subscribers.get(deviceId);
    if (!set) {
      set = new Set();
      this.subscribers.set(deviceId, set);
    }
    set.add(sub);
    return () => {
      const current = this.subscribers.get(deviceId);
      current?.delete(sub);
      if (current?.size === 0) this.subscribers.delete(deviceId);
    };
  }

  publish(deviceId: string, event: RelayEvent) {
    for (const sub of this.subscribers.get(deviceId) ?? []) sub.send(event);
  }

  /** Releases the device's long-polls and ends its SSE streams. */
  closeDevice(deviceId: string) {
    this.waiters.get(`${deviceId}:build`)?.finish('closed');
    this.waiters.get(`${deviceId}:input`)?.finish('closed');
    for (const sub of [...(this.subscribers.get(deviceId) ?? [])]) sub.close();
  }

  closeAll() {
    for (const waiter of [...this.waiters.values()]) waiter.finish('closed');
    for (const set of [...this.subscribers.values()]) for (const sub of [...set]) sub.close();
  }

  /** Open long-polls and SSE streams (tests and the leak check). */
  counts() {
    let subscribers = 0;
    for (const set of this.subscribers.values()) subscribers += set.size;
    return { waiters: this.waiters.size, subscribers };
  }
}
