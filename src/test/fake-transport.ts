import { vi } from 'vitest';
import type { Transport } from '../transport/types';

/** A `Transport` that records open/close calls in `events`, for flasher and upload tests. */
export interface FakeTransport extends Transport {
  readonly events: string[];
  isOpen: boolean;
  open: ReturnType<typeof vi.fn<Transport['open']>>;
  close: ReturnType<typeof vi.fn<Transport['close']>>;
}

export function fakeTransport(nativePort: unknown = { fake: 'port' }): FakeTransport {
  const events: string[] = [];
  const transport: FakeTransport = {
    kind: 'web-serial',
    isOpen: true,
    nativePort,
    events,
    open: vi.fn(async ({ baudRate }: { baudRate: number }) => {
      events.push(`open ${baudRate}`);
      transport.isOpen = true;
    }),
    close: vi.fn(async () => {
      events.push('close');
      transport.isOpen = false;
    }),
    write: vi.fn(async () => {}),
    onData: () => () => {},
    onDisconnect: () => () => {},
  };
  return transport;
}
