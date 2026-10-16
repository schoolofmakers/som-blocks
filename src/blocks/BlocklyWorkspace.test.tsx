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

  it('regenerates the code when the board changes, without re-injecting', () => {
    const onCodeChange = vi.fn();
    const { rerender } = render(
      <BlocklyWorkspace lang="es" onCodeChange={onCodeChange} boardId="esp32c3-supermini" />,
    );
    const workspace = Blockly.getMainWorkspace();
    // Mount emits once (from the inject effect), not again from the board effect.
    expect(onCodeChange).toHaveBeenCalledTimes(1);
    onCodeChange.mockClear();
    rerender(<BlocklyWorkspace lang="es" onCodeChange={onCodeChange} boardId="uno" />);
    expect(onCodeChange).toHaveBeenCalledTimes(1);
    expect(onCodeChange).toHaveBeenCalledWith(expect.stringContaining('void loop()'));
    expect(Blockly.getMainWorkspace()).toBe(workspace);
  });

  describe('project load / autosave props', () => {
    const raw = (code: string) => ({
      blocks: {
        languageVersion: 0,
        blocks: [{ type: 'som_raw_statement', x: 0, y: 0, fields: { CODE: code } }],
      },
    });

    it('loads the given workspace without echoing it back as a change', async () => {
      const onWorkspaceChange = vi.fn();
      const onCodeChange = vi.fn();
      render(
        <BlocklyWorkspace
          lang="es"
          load={{ key: 'a:1', state: raw('first();') }}
          onCodeChange={onCodeChange}
          onWorkspaceChange={onWorkspaceChange}
        />,
      );
      await waitFor(() =>
        expect(onCodeChange).toHaveBeenLastCalledWith(expect.stringContaining('first();')),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onWorkspaceChange).not.toHaveBeenCalled();
    });

    it('emits the serialized workspace on every non-UI change', async () => {
      const onWorkspaceChange = vi.fn();
      render(<BlocklyWorkspace lang="es" onWorkspaceChange={onWorkspaceChange} />);
      Blockly.serialization.blocks.append(
        { type: 'som_raw_statement', fields: { CODE: 'edit();' } },
        Blockly.getMainWorkspace(),
      );
      await waitFor(() =>
        expect(JSON.stringify(onWorkspaceChange.mock.lastCall?.[0])).toContain('edit();'),
      );
    });

    it('swaps blocks in place when the load key changes', async () => {
      const onCodeChange = vi.fn();
      const { rerender } = render(
        <BlocklyWorkspace
          lang="es"
          load={{ key: 'a:1', state: raw('a();') }}
          onCodeChange={onCodeChange}
        />,
      );
      const workspace = Blockly.getMainWorkspace();
      rerender(
        <BlocklyWorkspace
          lang="es"
          load={{ key: 'b:2', state: raw('b();') }}
          onCodeChange={onCodeChange}
        />,
      );
      expect(onCodeChange).toHaveBeenLastCalledWith(expect.stringContaining('b();'));
      expect(onCodeChange).toHaveBeenLastCalledWith(expect.not.stringContaining('a();'));
      expect(Blockly.getMainWorkspace()).toBe(workspace);
    });

    it('reports a workspace that cannot load and leaves the editor empty', () => {
      const onLoadError = vi.fn();
      const onCodeChange = vi.fn();
      render(
        <BlocklyWorkspace
          lang="es"
          load={{ key: 'bad:1', state: { blocks: { blocks: [{ type: 'no_such_block' }] } } }}
          onLoadError={onLoadError}
          onCodeChange={onCodeChange}
        />,
      );
      expect(onLoadError).toHaveBeenCalledTimes(1);
      expect(Blockly.getMainWorkspace().getAllBlocks(false)).toHaveLength(0);
      expect(onCodeChange).toHaveBeenLastCalledWith('void setup() {\n}\n\nvoid loop() {\n}\n');
    });
  });
});
