import { useEffect } from 'react';
import { useTransportStore } from '../transport/store';
import type { Transport } from '../transport/types';
import { useSerialStore } from './store';

function follow(transport: Transport | null): void {
  const serial = useSerialStore.getState();
  if (transport) {
    void serial.start(transport);
    return;
  }
  if (serial.status !== 'listening') return;
  // The transport store clears `transport` from its own disconnect listener, which runs before
  // ours: read the reason from it, so an unplug shows the unplug notice, not "connect first".
  const unplugged = useTransportStore.getState().error?.key === 'UI_CONNECT_ERROR_DISCONNECTED';
  serial.stop(unplugged ? 'disconnected' : 'idle');
}

/**
 * Starts and stops the serial store with the transport store's connection. Subscribes to the
 * store directly instead of reacting in a render effect, so listening starts in the same tick
 * the connection is published: what a board prints right after the port opens (its boot
 * message, an UNO's first line after the reset) is not lost waiting for React to commit.
 */
export function bindSerialToTransport(): () => void {
  follow(useTransportStore.getState().transport);
  return useTransportStore.subscribe((state, previous) => {
    if (state.transport !== previous.transport) follow(state.transport);
  });
}

export function useSerialSession(): void {
  useEffect(() => bindSerialToTransport(), []);
}
