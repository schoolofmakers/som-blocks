import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentChip, currentPinProfile } from '../blocks/pins';
import { DEFAULT_BOARD_ID, getBoard } from './registry';
import { BOARD_STORAGE_KEY, safeLocalStorage, useBoardStore } from './store';

function stored(): unknown {
  const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as { state: unknown }).state;
}

describe('board store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBoardStore.setState({ boardId: DEFAULT_BOARD_ID });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the ESP32-C3 SuperMini and its pin profile', () => {
    expect(useBoardStore.getState().boardId).toBe('esp32c3-supermini');
    expect(currentPinProfile()).toBe(getBoard('esp32c3-supermini').pins);
  });

  it('persists the selection under som.boardId and updates the pin profile', () => {
    useBoardStore.getState().setBoard('uno');
    expect(useBoardStore.getState().boardId).toBe('uno');
    expect(stored()).toEqual({ boardId: 'uno' });
    expect(currentPinProfile()).toBe(getBoard('uno').pins);
    expect(currentChip()).toBe('avr');
    useBoardStore.getState().setBoard('esp32c3-supermini');
    expect(currentChip()).toBe('esp32c3');
  });

  it('ignores unknown ids', () => {
    useBoardStore.getState().setBoard('nano-old');
    useBoardStore.getState().setBoard('not-a-board');
    expect(useBoardStore.getState().boardId).toBe('nano-old');
  });

  it('restores a stored board on rehydrate', async () => {
    window.localStorage.setItem(
      BOARD_STORAGE_KEY,
      JSON.stringify({ state: { boardId: 'nano-old' }, version: 0 }),
    );
    await useBoardStore.persist.rehydrate();
    expect(useBoardStore.getState().boardId).toBe('nano-old');
    expect(currentPinProfile()).toBe(getBoard('nano-old').pins);
  });

  it('falls back to the default when the stored board no longer exists', async () => {
    useBoardStore.getState().setBoard('uno');
    window.localStorage.setItem(
      BOARD_STORAGE_KEY,
      JSON.stringify({ state: { boardId: 'removed-board' }, version: 0 }),
    );
    await useBoardStore.persist.rehydrate();
    expect(useBoardStore.getState().boardId).toBe(DEFAULT_BOARD_ID);
  });

  it('falls back to the default on corrupt storage', async () => {
    useBoardStore.getState().setBoard('uno');
    window.localStorage.setItem(BOARD_STORAGE_KEY, '{not json');
    await useBoardStore.persist.rehydrate();
    // Parse failure: hydration is skipped, nothing throws, the in-memory choice stays.
    expect(useBoardStore.getState().boardId).toBe('uno');
  });

  it('keeps working when localStorage throws (private mode)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => useBoardStore.getState().setBoard('uno')).not.toThrow();
    expect(useBoardStore.getState().boardId).toBe('uno');
    await useBoardStore.persist.rehydrate();
    expect(useBoardStore.getState().boardId).toBe('uno');
  });

  it('safeLocalStorage swallows a missing localStorage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(safeLocalStorage.getItem('x')).toBeNull();
    expect(() => safeLocalStorage.setItem('x', 'y')).not.toThrow();
    expect(() => safeLocalStorage.removeItem('x')).not.toThrow();
  });
});
