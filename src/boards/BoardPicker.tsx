import { t, type Lang } from '../i18n/messages';
import { BOARDS, boardLabel, getBoard } from './registry';
import { useBoardStore } from './store';
import type { Chip } from './types';

// Chip names are product names: the same in every language.
const CHIP_LABELS: Record<Chip, string> = {
  avr: 'AVR',
  esp32: 'ESP32',
  esp32c3: 'ESP32-C3',
  esp8266: 'ESP8266',
};

interface BoardPickerProps {
  lang: Lang;
}

export function BoardPicker({ lang }: BoardPickerProps) {
  const boardId = useBoardStore((state) => state.boardId);
  const setBoard = useBoardStore((state) => state.setBoard);
  const board = getBoard(boardId);

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="board-picker" className="font-semibold text-muted">
        {t('UI_BOARD_LABEL', lang)}
      </label>
      <select
        id="board-picker"
        data-testid="board-picker"
        value={board.id}
        onChange={(event) => setBoard(event.target.value)}
        className="min-h-11 min-w-0 rounded-md border border-border bg-bg px-2 py-1 text-fg"
      >
        {BOARDS.map((option) => (
          <option key={option.id} value={option.id}>
            {boardLabel(option, lang)}
          </option>
        ))}
      </select>
      <span
        data-testid="board-chip"
        className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted"
      >
        {CHIP_LABELS[board.chip]}
      </span>
    </div>
  );
}
