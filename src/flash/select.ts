import type { BoardDefinition } from '../boards/types';
import { avrgirlFlasher } from './avrgirl';
import { esptoolFlasher } from './esptool';
import { FlashError, type Flasher } from './types';

// Both flasher modules are small: each loads its library (esptool-js, avrgirl-arduino) with a
// dynamic import inside `flash()`, so neither library lands in the main bundle.
const FLASHERS: Record<BoardDefinition['upload']['tool'], Flasher> = {
  esptool: esptoolFlasher,
  avrgirl: avrgirlFlasher,
};

/** The flasher for `board.upload.tool` (boards are data: no per-board code here). */
export function selectFlasher(board: Pick<BoardDefinition, 'id' | 'upload'>): Flasher {
  const flasher = FLASHERS[board.upload.tool] as Flasher | undefined;
  if (!flasher) {
    throw new FlashError('unsupported-board', `${board.id}: no flasher for "${board.upload.tool}"`);
  }
  return flasher;
}
