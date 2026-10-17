import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectsStore } from '../projects/store';
import type { Project } from '../projects/types';
import {
  CODE_VIEW_OPEN_STORAGE_KEY,
  COPIED_RESET_MS,
  CodeView,
  MAX_HIGHLIGHT_LINES,
} from './CodeView';

const SKETCH = `#include <Wire.h>

void setup() {
  pinMode(8, OUTPUT); // LED
}

void loop() {
  digitalWrite(8, LOW);
  delay(1000);
}
`;

const projectsInitial = useProjectsStore.getState();

function setMatchMedia(matches: boolean | undefined): void {
  if (matches === undefined) {
    vi.stubGlobal('matchMedia', undefined);
    return;
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches, media: query }) as unknown as MediaQueryList),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setMatchMedia(true);
  useProjectsStore.setState(projectsInitial, true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // setup.ts stubs fetch globally; unstubAllGlobals removed it, so put it back.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

async function renderHighlighted(code = SKETCH, lang: 'es' | 'en' = 'es') {
  const view = render(<CodeView code={code} lang={lang} />);
  await waitFor(() =>
    expect(screen.getByTestId('generated-code')).toHaveAttribute('data-highlighted', 'true'),
  );
  return view;
}

describe('CodeView', () => {
  it('shows the plain code at once, then highlights it with the same text', async () => {
    render(<CodeView code={SKETCH} lang="es" />);
    expect(screen.getByTestId('generated-code').textContent).toBe(SKETCH);

    await waitFor(() =>
      expect(screen.getByTestId('generated-code')).toHaveAttribute('data-highlighted', 'true'),
    );
    const code = screen.getByTestId('generated-code');
    expect(code.textContent).toBe(SKETCH);
    expect(code.querySelector('.hljs-keyword')).not.toBeNull();
    expect(code.querySelector('.hljs-comment')).toHaveTextContent('// LED');
    // `<Wire.h>` stays text, never an element.
    expect(code.innerHTML).toContain('&lt;Wire.h&gt;');
  });

  it('numbers every line, outside the code text', async () => {
    await renderHighlighted();
    const gutter = screen.getByTestId('code-line-numbers');
    const numbers = (gutter.textContent ?? '').split('\n');
    expect(numbers).toHaveLength(10);
    expect(numbers.at(-1)).toBe('10');
    expect(gutter).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('generated-code').textContent).not.toMatch(/^1\n/);
  });

  it('copies through the Clipboard API and shows "Copiado" briefly', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await renderHighlighted();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    });
    expect(writeText).toHaveBeenCalledWith(SKETCH);
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(COPIED_RESET_MS);
    });
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });

  it('falls back to a textarea + execCommand when the Clipboard API is missing', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    let copied: string | null = null;
    const execCommand = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? null;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await renderHighlighted();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe(SKETCH);
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('tells the student to copy by hand when both copy paths fail', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => false),
      configurable: true,
    });
    await renderHighlighted();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo copiar');
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });

  it('downloads <sketch-name>.ino with the code as a text blob', async () => {
    useProjectsStore.setState({
      current: { id: 'p1', name: 'Semáforo rojo', boardId: 'uno' } as Project,
    });
    let blob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      blob = value as Blob;
      return 'blob:som/1';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    await renderHighlighted();

    fireEvent.click(screen.getByRole('button', { name: 'Descargar .ino' }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('Semaforo_rojo.ino');
    expect(clicked[0]?.href).toBe('blob:som/1');
    expect(blob).not.toBeNull();
    const file = blob as unknown as Blob;
    expect(file.type).toBe('text/plain;charset=utf-8');
    expect(await file.text()).toBe(SKETCH);
  });

  it('falls back to the default project name for the .ino when no project is open', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:som/2');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await renderHighlighted(SKETCH, 'en');

    fireEvent.click(screen.getByRole('button', { name: 'Download .ino' }));
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('My_project.ino');
  });

  it('starts collapsed below lg and open on desktop when nothing is stored', () => {
    setMatchMedia(false);
    const phone = render(<CodeView code={SKETCH} lang="es" />);
    expect(screen.getByRole('button', { name: 'Ver código' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Hidden, not unmounted: the text is still there for copy and tests.
    expect(screen.getByTestId('generated-code')).not.toBeVisible();
    expect(screen.getByTestId('generated-code').textContent).toBe(SKETCH);
    phone.unmount();

    setMatchMedia(true);
    render(<CodeView code={SKETCH} lang="es" />);
    expect(screen.getByRole('button', { name: 'Ocultar código' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('generated-code')).toBeVisible();
  });

  it('remembers the collapse choice in localStorage over the screen-size default', () => {
    setMatchMedia(true);
    const first = render(<CodeView code={SKETCH} lang="es" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar código' }));
    expect(window.localStorage.getItem(CODE_VIEW_OPEN_STORAGE_KEY)).toBe('0');
    expect(screen.getByTestId('generated-code')).not.toBeVisible();
    first.unmount();

    render(<CodeView code={SKETCH} lang="es" />);
    expect(screen.getByRole('button', { name: 'Ver código' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver código' }));
    expect(window.localStorage.getItem(CODE_VIEW_OPEN_STORAGE_KEY)).toBe('1');
    expect(screen.getByTestId('generated-code')).toBeVisible();
  });

  it('still works when localStorage and matchMedia are unavailable', () => {
    setMatchMedia(undefined);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    render(<CodeView code={SKETCH} lang="es" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar código' }));
    expect(screen.getByRole('button', { name: 'Ver código' })).toBeInTheDocument();
  });

  it('shows a 2 000-line sketch as plain text with a note instead of colouring it', async () => {
    const view = await renderHighlighted();
    const long = Array.from({ length: 2000 }, (_, i) => `  delay(${i}); // line ${i + 1}`)
      .join('\n')
      .concat('\n');
    expect(2000).toBeGreaterThan(MAX_HIGHLIGHT_LINES);

    const started = performance.now();
    view.rerender(<CodeView code={long} lang="es" />);
    const elapsed = performance.now() - started;

    const code = screen.getByTestId('generated-code');
    expect(code).not.toHaveAttribute('data-highlighted');
    expect(code.textContent).toBe(long);
    expect(code.querySelector('span')).toBeNull();
    expect(screen.getByTestId('code-line-numbers').textContent?.split('\n')).toHaveLength(2000);
    expect(screen.getByText(/muy largo/)).toBeInTheDocument();
    // Generous bound for slow CI; colouring 2 000 lines on every edit is what we avoid.
    expect(elapsed).toBeLessThan(1000);
  });

  it('disables copy and download while there is no code', () => {
    render(<CodeView code="" lang="es" />);
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar .ino' })).toBeDisabled();
  });
});
