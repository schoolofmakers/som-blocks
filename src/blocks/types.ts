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

/**
 * Which toolbox the editor shows (docs/adr/0001-starter-toolbox.md): `starter` for ages
 * 10–14 (the default), `full` adds the advanced blocks and categories.
 */
export type ToolboxProfile = 'starter' | 'full';

export interface ToolboxBlock {
  kind: 'block';
  type: string;
  fields?: Record<string, unknown>;
  /** Blockly JSON toolbox inputs, e.g. `{ A: { shadow: { type: 'math_number' } } }`. */
  inputs?: Record<string, unknown>;
  /** Blockly JSON block extra state, e.g. `{ hasElse: true }` for `controls_if`. */
  extraState?: unknown;
  /** Only in the `full` toolbox profile. */
  fullOnly?: boolean;
}

export interface ToolboxSeparator {
  kind: 'sep';
}

export interface ToolboxCategory {
  kind: 'category';
  /** Category label: a `%{BKY_…}` message reference, never a literal. */
  name: string;
  colour?: string;
  /** A dynamic category filled by Blockly (`VARIABLE`, `PROCEDURE`); `contents` stays empty. */
  custom?: string;
  contents: ToolboxItem[];
  /** Only in the `full` toolbox profile. */
  fullOnly?: boolean;
}

export type ToolboxItem = ToolboxBlock | ToolboxSeparator | ToolboxCategory;

/** Flat message keys namespaced by family (e.g. `SOM_RAW_STATEMENT`), one dict per language. */
export type FamilyMessages = Record<Lang, Record<string, string>>;

export interface BlockFamily {
  /** Stable family id, e.g. `raw`, `io`, `espnow`. */
  id: string;
  blocks: BlockDefinition[];
  /**
   * Block types defined outside our families (Blockly's core blocks from `blockly/blocks`)
   * that this family supplies the generators for. Like `blocks`, each one is owned by
   * exactly one family and needs a generator.
   */
  externalBlocks?: string[];
  /** Keyed by block type; every type in `blocks` and `externalBlocks` needs a generator. */
  generators: Record<string, BlockGenerator>;
  toolbox: ToolboxCategory | ToolboxItem[];
  messages: FamilyMessages;
  /**
   * Blockly extensions the family's block definitions name in `extensions: [...]` (e.g. a
   * tooltip that depends on the selected board). Names must be unique across families.
   */
  extensions?: Record<string, (this: Block) => void>;
}
