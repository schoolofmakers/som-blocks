import * as Blockly from 'blockly/core';
import { arduinoGenerator, Order } from '../arduino-generator';
import type { PinProfile } from '../pins';
import type { BlockFamily } from '../types';

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

export const num = (n: string | number): BlockState => ({
  type: 'golden_number',
  fields: { NUM: String(n) },
});

/**
 * Literal value blocks for fixtures. The real number/text blocks arrive with the core
 * families (B3), which run in parallel with B4; once they land, fixtures can switch to them.
 */
export const goldenLiteralsFamily: BlockFamily = {
  id: 'golden_literals',
  blocks: [
    {
      type: 'golden_number',
      message0: '%1',
      args0: [{ type: 'field_input', name: 'NUM', text: '0' }],
      output: 'Number',
    },
    {
      type: 'golden_text',
      message0: '"%1"',
      args0: [{ type: 'field_input', name: 'TEXT', text: '' }],
      output: 'String',
    },
  ],
  generators: {
    golden_number: (block) => [String(block.getFieldValue('NUM')), Order.ATOMIC],
    golden_text: (block) => [JSON.stringify(String(block.getFieldValue('TEXT'))), Order.ATOMIC],
  },
  toolbox: [],
  messages: { es: {}, en: {} },
};

/**
 * ESP32-C3 SuperMini-like profile (variants/nologo_esp32c3_super_mini in arduino-esp32):
 * blue LED on GPIO 8, active-low; ADC1 on GPIO 0–4; 12-bit analogRead. B5 owns the real one.
 */
export const C3_LIKE_PROFILE: PinProfile = {
  digital: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '20', '21'].map((v) => [
    `GPIO ${v}`,
    v,
  ]),
  analog: ['0', '1', '2', '3', '4'].map((v) => [`GPIO ${v}`, v]),
  pwm: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '20', '21'].map((v) => [
    `GPIO ${v}`,
    v,
  ]),
  builtinLed: '8',
  builtinLedActiveLow: true,
  analogMax: 4095,
};
