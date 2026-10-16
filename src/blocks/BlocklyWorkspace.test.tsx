import { render, screen, waitFor } from '@testing-library/react';
import * as Blockly from 'blockly/core';
import { describe, expect, it, vi } from 'vitest';
import { BlocklyWorkspace } from './BlocklyWorkspace';

describe('BlocklyWorkspace', () => {
  it('injects a workspace on mount and emits the empty sketch', async () => {
    const onCodeChange = vi.fn();
    render(<BlocklyWorkspace lang="es" onCodeChange={onCodeChange} />);
    const host = screen.getByTestId('blockly-workspace');
    expect(host.querySelector('.blocklySvg')).not.toBeNull();
    await waitFor(() =>
      expect(onCodeChange).toHaveBeenCalledWith('void setup() {\n}\n\nvoid loop() {\n}\n'),
    );
  });

  it('disposes the workspace on unmount', () => {
    const before = Blockly.Workspace.getAll().length;
    const { unmount } = render(<BlocklyWorkspace lang="en" />);
    expect(Blockly.Workspace.getAll().length).toBeGreaterThan(before);
    unmount();
    expect(Blockly.Workspace.getAll().length).toBe(before);
  });

  it('emits code on block changes and keeps blocks across a language switch', async () => {
    const onCodeChange = vi.fn();
    const { rerender } = render(<BlocklyWorkspace lang="es" onCodeChange={onCodeChange} />);
    Blockly.serialization.blocks.append(
      { type: 'som_raw_statement', fields: { CODE: 'blink();' } },
      Blockly.getMainWorkspace(),
    );
    await waitFor(() =>
      expect(onCodeChange).toHaveBeenLastCalledWith(expect.stringContaining('  blink();\n')),
    );

    onCodeChange.mockClear();
    rerender(<BlocklyWorkspace lang="en" onCodeChange={onCodeChange} />);
    expect(onCodeChange).toHaveBeenCalledWith(expect.stringContaining('  blink();\n'));
    expect(screen.getByTestId('blockly-workspace')).toHaveAccessibleName('Blocks workspace');
  });
});
