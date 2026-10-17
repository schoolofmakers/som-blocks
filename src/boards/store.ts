import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { setCurrentChip, setPinProfile } from '../blocks/pins';
import { DEFAULT_BOARD_ID, getBoard, isBoardId } from './registry';

export const BOARD_STORAGE_KEY = 'som.boardId';

interface BoardState {
  boardId: string;
  setBoard: (id: string) => void;
}

// localStorage can be missing or throw (Safari private mode, site data blocked, quota).
// zustand's persist does not catch a throwing setItem, so every call is guarded here: the
// picker keeps working for the session and simply forgets the choice on reload.
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Not persisted; fine.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Nothing to remove.
    }
  },
};

export const useBoardStore = create<BoardState>()(
  persist(
    (set) => ({
      boardId: DEFAULT_BOARD_ID,
      setBoard: (id) => {
        if (isBoardId(id)) set({ boardId: id });
      },
    }),
    {
      name: BOARD_STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({ boardId: state.boardId }),
      // Nothing stored (first visit, storage blocked): keep the current choice. A stored id
      // from an older build (board renamed or removed) falls back to the default board.
      merge: (persisted, current) => {
        if (persisted === undefined || persisted === null) return current;
        const stored = (persisted as Partial<BoardState>).boardId;
        return { ...current, boardId: isBoardId(stored) ? stored : DEFAULT_BOARD_ID };
      },
    },
  ),
);

/** Keep the blocks' pin profile and chip on the selected board (B4 dropdowns, BLE gating). */
function syncPinProfile(boardId: string): void {
  const board = getBoard(boardId);
  setPinProfile(board.pins);
  setCurrentChip(board.chip);
}

syncPinProfile(useBoardStore.getState().boardId);
useBoardStore.subscribe((state, previous) => {
  if (state.boardId !== previous.boardId) syncPinProfile(state.boardId);
});
