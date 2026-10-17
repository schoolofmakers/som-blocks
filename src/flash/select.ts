import type { BoardDefinition } from '../boards/types';
import type { TransportKind } from '../transport/types';
import { avrgirlFlasher } from './avrgirl';
import { esptoolFlasher } from './esptool';
import { relayOtaFlasher } from './relay-ota';
import { FlashError, type Flasher } from './types';

// Both cable flasher modules are small: each loads its library (esptool-js, avrgirl-arduino)
// with a dynamic import inside `flash()`, so neither library lands in the main bundle. The
// WiFi flasher needs no library (fetch + WebCrypto).
const FLASHERS: Record<BoardDefinition['upload']['tool'], Flasher> = {
  esptool: esptoolFlasher,
  avrgirl: avrgirlFlasher,
};

/**
 * The flasher for the open connection: over WiFi (`relay`) the relay OTA flasher, for any
 * board that can be flagged "sube por WiFi" (`otaOptions`); over USB the board's own tool
 * (boards are data: no per-board code here). The transport store keeps one connection at a
 * time, so a USB port that is open is always what gets flashed.
 */
export function selectFlasher(
  board: Pick<BoardDefinition, 'id' | 'upload' | 'otaOptions'>,
  transportKind: TransportKind = 'web-serial',
): Flasher {
  if (transportKind === 'relay') {
    if (!board.otaOptions) {
      throw new FlashError('unsupported-board', `${board.id}: no upload over WiFi`);
    }
    return relayOtaFlasher;
  }
  const flasher = FLASHERS[board.upload.tool] as Flasher | undefined;
  if (!flasher) {
    throw new FlashError('unsupported-board', `${board.id}: no flasher for "${board.upload.tool}"`);
  }
  return flasher;
}
