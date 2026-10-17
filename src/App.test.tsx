import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Blockly from 'blockly/core';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { LANG_STORAGE_KEY } from './i18n/lang';
import { useProjectsStore } from './projects/store';

describe('App shell', () => {
  it('renders the title, the workspace and Spanish copy by default', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Programa tu placa con bloques')).toBeInTheDocument();
    // The editor mounts once the first project is open (memory store in jsdom).
    expect(await screen.findByRole('region', { name: 'Espacio de bloques' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Código generado' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('generated-code')).toHaveTextContent('void loop()'),
    );
  });

  it('renders English copy when asked', () => {
    render(<App lang="en" />);
    expect(screen.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Program your board with blocks')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Generated code' })).toBeInTheDocument();
    expect(screen.queryByText('Programa tu placa con bloques')).not.toBeInTheDocument();
  });

  describe('language switch', () => {
    afterEach(() => {
      window.localStorage.clear();
    });

    it('switches every string live, persists the choice and keeps the blocks', async () => {
      render(<App lang="es" />);
      await screen.findByRole('region', { name: 'Espacio de bloques' });
      expect(screen.getByRole('treeitem', { name: 'Lógica' })).toBeInTheDocument();
      Blockly.serialization.blocks.append(
        { type: 'som_raw_statement', fields: { CODE: 'blink();' } },
        Blockly.getMainWorkspace(),
      );
      await waitFor(() =>
        expect(screen.getByTestId('generated-code')).toHaveTextContent('blink();'),
      );

      const group = screen.getByRole('group', { name: 'Idioma' });
      const english = within(group).getByRole('button', { name: 'English' });
      expect(within(group).getByRole('button', { name: 'Español' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      fireEvent.click(english);

      // Shell copy, <html lang>, the tab title and the persisted preference.
      expect(screen.getByText('Program your board with blocks')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
      expect(english).toHaveAttribute('aria-pressed', 'true');
      expect(document.documentElement.lang).toBe('en');
      expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
      // Blockly re-injected in English (toolbox labels from the family messages)…
      expect(screen.getByRole('region', { name: 'Blocks workspace' })).toBeInTheDocument();
      expect(screen.getByRole('treeitem', { name: 'Logic' })).toBeInTheDocument();
      // …and kept the student's blocks.
      expect(
        Blockly.getMainWorkspace()
          .getAllBlocks(false)
          .map((block) => block.type),
      ).toEqual(['som_raw_statement']);
      expect(screen.getByTestId('generated-code')).toHaveTextContent('blink();');

      // Projects created after the switch get the English default name.
      await act(() => useProjectsStore.getState().create());
      expect(useProjectsStore.getState().current?.name).toBe('My project');
    });
  });
});
