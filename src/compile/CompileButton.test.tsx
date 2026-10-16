import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompileButton } from './CompileButton';
import { useCompileStore } from './store';

const initial = useCompileStore.getState();
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  useCompileStore.setState(initial, true);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ log: '' })));
  vi.stubGlobal('fetch', fetchMock);
});

async function sentFqbn(boardId: string): Promise<string> {
  render(<CompileButton lang="en" code="void setup() {}" boardId={boardId} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(useCompileStore.getState().status).toBe('error'));
  return (JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { fqbn: string }).fqbn;
}

describe('CompileButton', () => {
  it('compiles for the selected board with its options in the fqbn', async () => {
    expect(await sentFqbn('esp32c3-supermini')).toBe('esp32:esp32:esp32c3:CDCOnBoot=cdc');
  });

  it('sends the bare fqbn for a board without options', async () => {
    expect(await sentFqbn('uno')).toBe('arduino:avr:uno');
  });

  it('is disabled while there is no code', () => {
    render(<CompileButton lang="en" code="" boardId="uno" />);
    expect(screen.getByRole('button', { name: 'Compile' })).toBeDisabled();
  });
});
