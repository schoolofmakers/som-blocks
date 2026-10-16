import * as Blockly from 'blockly/core';
import { arduinoGenerator } from '../arduino-generator';

// Test-only helpers for golden fixtures and family unit tests.

export type BlockState = Blockly.serialization.blocks.State;

let workspace: Blockly.Workspace | undefined;

/** Chain block states into one stack (each one the `next` of the previous). */
export function stack(...blocks: BlockState[]): BlockState {
  const [first, ...rest] = blocks;
  if (!first) throw new Error('empty stack');
  return rest.length ? { ...first, next: { block: stack(...rest) } } : first;
}

/** Load top-level blocks into a fresh headless workspace (the previous one is disposed). */
export function load(...topBlocks: BlockState[]): Blockly.Workspace {
  disposeTestWorkspace();
  workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    {
      blocks: {
        languageVersion: 0,
        blocks: topBlocks.map((b, i) => ({ ...b, x: 0, y: i * 100 })),
      },
    },
    workspace,
  );
  return workspace;
}

export function disposeTestWorkspace(): void {
  workspace?.dispose();
  workspace = undefined;
}

/** Generate the sketch for top-level blocks. */
export function generate(...topBlocks: BlockState[]): string {
  return arduinoGenerator.workspaceToCode(load(...topBlocks));
}

/** The trimmed lines inside `void setup() { … }`. */
export function setupBody(code: string): string[] {
  const match = /void setup\(\) \{\n([\s\S]*?)\n?\}/.exec(code);
  return match?.[1] ? match[1].split('\n').map((l) => l.trim()) : [];
}

/** A number literal: Blockly's core `math_number` block (math family generator). */
export const num = (n: string | number): BlockState => ({
  type: 'math_number',
  fields: { NUM: Number(n) },
});
