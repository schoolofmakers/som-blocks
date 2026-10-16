import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogPanel } from './LogPanel';
import { useCompileStore } from './store';
import { CompileError } from './types';

const initial = useCompileStore.getState();

beforeEach(() => {
  useCompileStore.setState(initial, true);
});

describe('LogPanel', () => {
  it('shows the idle hint before any compile', () => {
    render(<LogPanel lang="es" />);
    expect(screen.getByTestId('compile-status')).toHaveTextContent(
      'Pulsa Compilar para revisar tu programa.',
    );
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeDisabled();
  });

  it('renders the compiler log verbatim, including < and > and indentation', () => {
    const log =
      'sketch.ino:1:10: fatal error: <Servo2.h>: No such file or directory\n    1 | #include <Servo2.h>\n      |          ^~~~~~~~~~~\ncompilation terminated.\n';
    act(() => {
      useCompileStore.setState({
        status: 'error',
        log,
        error: new CompileError('no-firmware', 'The server sent no firmware', log),
        durationMs: 2400,
      });
    });
    render(<LogPanel lang="en" />);
    const pre = screen.getByTestId('compile-log');
    // textContent is exactly the log: nothing escaped, trimmed or collapsed.
    expect(pre.textContent).toBe(log);
    expect(pre.innerHTML).toContain('&lt;Servo2.h&gt;');
    expect(pre.querySelector('Servo2\\.h')).toBeNull();
    expect(screen.getByTestId('compile-status')).toHaveTextContent(
      'Your program has errors. Read the compiler output. (Failed after 2.4 s)',
    );
  });

  it('drops ANSI colour codes from the arduino-cli summary table', () => {
    act(() => {
      useCompileStore.setState({
        status: 'error',
        log: '\u001b[92mUsed platform\u001b[0m \u001b[92mVersion\u001b[0m\n\u001b[93marduino:avr\u001b[0m 1.8.8\n',
        error: new CompileError('no-firmware', 'x'),
      });
    });
    render(<LogPanel lang="en" />);
    expect(screen.getByTestId('compile-log').textContent).toBe(
      'Used platform Version\narduino:avr 1.8.8\n',
    );
  });

  it('shows duration and firmware size after an AVR compile', () => {
    act(() => {
      useCompileStore.setState({
        status: 'ok',
        log: 'Sketch uses 924 bytes\n',
        result: { kind: 'avr', hex: new Uint8Array(2615), log: 'Sketch uses 924 bytes\n' },
        durationMs: 3210,
      });
    });
    render(<LogPanel lang="es" />);
    expect(screen.getByTestId('compile-status')).toHaveTextContent(
      'Listo en 3.2 s · firmware 2615 bytes',
    );
  });

  it('shows the image count after an ESP compile', () => {
    const images = [0xe000, 0, 0x10000, 0x8000].map((address) => ({
      data: new Uint8Array(10),
      address,
    }));
    act(() => {
      useCompileStore.setState({
        status: 'ok',
        result: { kind: 'esp', images, log: '' },
        durationMs: 12000,
      });
    });
    render(<LogPanel lang="en" />);
    expect(screen.getByTestId('compile-status')).toHaveTextContent(
      'Done in 12.0 s · 4 images (40 bytes)',
    );
  });

  it.each([
    ['network', 'Could not reach the compile server (http://x.test). Check your internet.'],
    ['timeout', 'The server did not answer within 45 s. Try again.'],
    ['empty-body', 'The server sent an empty answer.'],
    ['server-error', 'The compile server reported an error: Invalid FQBN'],
  ] as const)('explains a %s failure', (cause, text) => {
    act(() => {
      useCompileStore.setState({
        status: 'error',
        serverUrl: 'http://x.test',
        error: new CompileError(cause, 'Invalid FQBN'),
        durationMs: 100,
      });
    });
    render(<LogPanel lang="en" />);
    expect(screen.getByTestId('compile-status')).toHaveTextContent(text);
  });
});
