import type { Block } from 'blockly/core';
import type { Lang } from '../i18n/messages';
import type { ArduinoGenerator, Order } from './arduino-generator';

// Block-family module contract (_config/standards.md → Code): one family = one module
// exporting `{ blocks, generators, toolbox, messages }`. A family only writes to the shared
// ArduinoGenerator sections through its public API (addInclude / addDefinition / addSetup);
// it never reads or mutates another family's state.

/** A Blockly JSON block definition (the shape `Blockly.defineBlocksWithJsonArray` takes). */
export interface BlockDefinition {
  type: string;
  [key: string]: unknown;
}

/**
 * Turns one block into Arduino C++. Statement blocks return a string (lines ending in
 * `\n`); value blocks return `[code, Order]`.
 */
export type BlockGenerator = (
  block: Block,
  generator: ArduinoGenerator,
) => string | [string, Order] | null;

export interface ToolboxBlock {
  kind: 'block';
  type: string;
  fields?: Record<string, unknown>;
}

export interface ToolboxSeparator {
  kind: 'sep';
}

export interface ToolboxCategory {
  kind: 'category';
  /** Category label: a `%{BKY_…}` message reference, never a literal. */
  name: string;
  colour?: string;
  contents: ToolboxItem[];
}

export type ToolboxItem = ToolboxBlock | ToolboxSeparator | ToolboxCategory;

/** Flat message keys namespaced by family (e.g. `SOM_RAW_STATEMENT`), one dict per language. */
export type FamilyMessages = Record<Lang, Record<string, string>>;

export interface BlockFamily {
  /** Stable family id, e.g. `raw`, `io`, `espnow`. */
  id: string;
  blocks: BlockDefinition[];
  /** Keyed by block type; every type in `blocks` needs a generator. */
  generators: Record<string, BlockGenerator>;
  toolbox: ToolboxCategory | ToolboxItem[];
  messages: FamilyMessages;
}
