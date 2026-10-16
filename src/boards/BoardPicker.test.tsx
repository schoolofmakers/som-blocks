import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentPinProfile } from '../blocks/pins';
import { BoardPicker } from './BoardPicker';
import { DEFAULT_BOARD_ID, getBoard } from './registry';
import { useBoardStore } from './store';

describe('BoardPicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBoardStore.setState({ boardId: DEFAULT_BOARD_ID });
  });

  it('shows the boards with the C3 selected by default (es)', () => {
    render(<BoardPicker lang="es" />);
    const select = screen.getByRole('combobox', { name: 'Placa' });
    expect(select).toHaveValue('esp32c3-supermini');
    expect(screen.getByRole('option', { name: 'ESP32-C3 SuperMini' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Arduino UNO' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Arduino NANO (bootloader viejo)' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('board-chip')).toHaveTextContent('ESP32-C3');
  });

  it('switches board, chip badge and pin profile (en)', () => {
    render(<BoardPicker lang="en" />);
    const select = screen.getByRole('combobox', { name: 'Board' });
    fireEvent.change(select, { target: { value: 'uno' } });
    expect(select).toHaveValue('uno');
    expect(useBoardStore.getState().boardId).toBe('uno');
    expect(screen.getByTestId('board-chip')).toHaveTextContent('AVR');
    expect(currentPinProfile()).toBe(getBoard('uno').pins);
    expect(
      screen.getByRole('option', { name: 'Arduino NANO (old bootloader)' }),
    ).toBeInTheDocument();
  });
});
