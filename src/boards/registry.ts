import { esp32c3SuperMini } from './definitions/esp32c3-supermini';
import { nanoOld } from './definitions/nano-old';
import { uno } from './definitions/uno';
import { t, type Lang } from '../i18n/messages';
import type { BoardDefinition } from './types';

/** Every board the editor offers, in picker order. Add a board here and in definitions/. */
export const BOARDS: readonly BoardDefinition[] = [esp32c3SuperMini, uno, nanoOld];

export const DEFAULT_BOARD_ID = esp32c3SuperMini.id;

export function isBoardId(id: unknown): id is string {
  return typeof id === 'string' && BOARDS.some((board) => board.id === id);
}

/** The board with this id, or the default board when the id is unknown (e.g. removed). */
export function getBoard(id: string): BoardDefinition {
  return BOARDS.find((board) => board.id === id) ?? esp32c3SuperMini;
}

/** Picker label: the untranslated product name plus its translated variant, if any. */
export function boardLabel(board: BoardDefinition, lang: Lang): string {
  return board.variantKey ? `${board.name} (${t(board.variantKey, lang)})` : board.name;
}
