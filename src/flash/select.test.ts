import { describe, expect, it } from 'vitest';
import { BOARDS } from '../boards/registry';
import type { BoardDefinition } from '../boards/types';
import { avrgirlFlasher } from './avrgirl';
import { esptoolFlasher } from './esptool';
import { selectFlasher } from './select';
import { FlashError } from './types';

describe('selectFlasher', () => {
  it('picks the flasher by board.upload.tool', () => {
    const byId = Object.fromEntries(BOARDS.map((board) => [board.id, selectFlasher(board)]));
    expect(byId['esp32c3-supermini']).toBe(esptoolFlasher);
    expect(byId['uno']).toBe(avrgirlFlasher);
    expect(byId['nano-old']).toBe(avrgirlFlasher);
  });

  it('only esptool can be cancelled midway', () => {
    expect(esptoolFlasher.supportsCancel).toBe(true);
    expect(avrgirlFlasher.supportsCancel).toBe(false);
  });

  it('an unknown tool is unsupported-board, not a crash', () => {
    const board = {
      id: 'mystery',
      upload: { tool: 'picotool' },
    } as unknown as Pick<BoardDefinition, 'id' | 'upload'>;
    expect(() => selectFlasher(board)).toThrow(FlashError);
    try {
      selectFlasher(board);
    } catch (error) {
      expect((error as FlashError).code).toBe('unsupported-board');
    }
  });
});
