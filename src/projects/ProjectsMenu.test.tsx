import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOARD_ID } from '../boards/registry';
import { useBoardStore } from '../boards/store';
import { MemoryProjectRepo } from './db';
import { ProjectNotice, ProjectsMenu } from './ProjectsMenu';
import { relativeTime } from './relative-time';
import { resetProjectsStore, useProjectsStore } from './store';

const state = () => useProjectsStore.getState();

function openMenu() {
  fireEvent.click(screen.getByText('Proyectos'));
  return screen.getByRole('menu');
}

describe('ProjectsMenu', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    useBoardStore.setState({ boardId: DEFAULT_BOARD_ID });
    resetProjectsStore();
    await state().init({ repo: new MemoryProjectRepo() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the open project name and renames it inline', async () => {
    render(<ProjectsMenu lang="es" />);
    const name = screen.getByRole('textbox', { name: 'Nombre del proyecto' });
    expect(name).toHaveValue('Mi proyecto');

    fireEvent.change(name, { target: { value: 'Semáforo' } });
    fireEvent.blur(name);
    await waitFor(() => expect(state().current?.name).toBe('Semáforo'));
    expect(name).toHaveValue('Semáforo');
  });

  it('Escape cancels a rename', async () => {
    render(<ProjectsMenu lang="es" />);
    const name = screen.getByRole('textbox', { name: 'Nombre del proyecto' });
    fireEvent.change(name, { target: { value: 'Otro' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name).toHaveValue('Mi proyecto');
    fireEvent.blur(name);
    await act(async () => {});
    expect(state().current?.name).toBe('Mi proyecto');
  });

  it('creates a project and lists recent projects, newest first, with a localized age', async () => {
    render(<ProjectsMenu lang="es" />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Nuevo proyecto' }));
    await waitFor(() => expect(state().current?.name).toBe('Mi proyecto (2)'));

    const recent = within(openMenu()).getByTestId('recent-projects');
    const items = within(recent).getAllByRole('menuitem');
    expect(items.map((i) => i.querySelector('span')?.textContent)).toEqual([
      'Mi proyecto (2)',
      'Mi proyecto',
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[0]).toHaveTextContent('editado ahora');
  });

  it('opens a project from the recent list', async () => {
    const first = state().current!.id;
    await state().create('Segundo');
    render(<ProjectsMenu lang="en" />);
    fireEvent.click(screen.getByText('Projects'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Mi proyecto/ }));
    await waitFor(() => expect(state().current?.id).toBe(first));
  });

  it('deletes only after confirmation', async () => {
    await state().create('Borrable');
    const id = state().current!.id;
    render(<ProjectsMenu lang="es" />);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Borrar' }));
    expect(confirm).toHaveBeenCalledWith('¿Borrar «Borrable»? No se puede deshacer.');
    expect(state().projects.some((p) => p.id === id)).toBe(true);

    confirm.mockReturnValueOnce(true);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Borrar' }));
    await waitFor(() => expect(state().projects.some((p) => p.id === id)).toBe(false));
  });

  it('duplicates, exports and imports through the store', async () => {
    const duplicate = vi.spyOn(state(), 'duplicate');
    const exportZip = vi.spyOn(state(), 'exportZip').mockResolvedValue();
    const importFile = vi.spyOn(state(), 'importFile').mockResolvedValue();
    const id = state().current!.id;
    render(<ProjectsMenu lang="en" />);

    fireEvent.click(screen.getByText('Projects'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(duplicate).toHaveBeenCalledWith(id);

    fireEvent.click(screen.getByText('Projects'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export (.zip)' }));
    expect(exportZip).toHaveBeenCalledWith(state().current!.id);

    const file = new File(['{}'], 'p.json');
    fireEvent.change(screen.getByTestId('project-import-input'), { target: { files: [file] } });
    expect(importFile).toHaveBeenCalledWith(file);
  });
});

describe('ProjectNotice', () => {
  beforeEach(() => resetProjectsStore());

  it('warns when projects only live in memory', async () => {
    await state().init({ repo: new MemoryProjectRepo() });
    render(<ProjectNotice lang="es" />);
    expect(screen.getByTestId('projects-memory-only')).toHaveTextContent(
      'Este navegador no deja guardar proyectos',
    );
  });

  it('shows a dismissable notice', () => {
    useProjectsStore.setState({
      notice: { kind: 'unknown-board', name: 'Futuro', boardId: 'esp32-s9' },
    });
    render(<ProjectNotice lang="en" />);
    expect(screen.getByTestId('project-notice')).toHaveTextContent(
      '“Futuro” used a board we don’t know (esp32-s9). We opened it with the ESP32-C3 SuperMini.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('project-notice')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 16, 12);
  it('localizes minutes, hours and days', () => {
    expect(relativeTime(now - 3 * 60_000, now, 'es')).toBe('hace 3 minutos');
    expect(relativeTime(now - 3 * 60_000, now, 'en')).toBe('3 minutes ago');
    expect(relativeTime(now - 2 * 3_600_000, now, 'en')).toBe('2 hours ago');
    expect(relativeTime(now - 86_400_000, now, 'es')).toBe('ayer');
  });
});
