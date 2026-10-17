import * as Blockly from 'blockly/core';
import * as blocklyEn from 'blockly/msg/en';
import * as blocklyEs from 'blockly/msg/es';
import { DEFAULT_LANG, warnMissingTranslation, type Lang } from '../i18n/messages';
import { arduinoGenerator } from './arduino-generator';
import type { BlockFamily, ToolboxItem, ToolboxProfile } from './types';

// Family registry: the only place that writes family data into Blockly's globals
// (Blockly.Blocks, generator.forBlock, Blockly.Msg). Families stay plain data modules.

const families = new Map<string, BlockFamily>();
/** block type → owning family id, so two families can never claim the same block. */
const blockOwners = new Map<string, string>();
/** Language last passed to applyLocale; families registered later get it immediately. */
let currentLang: Lang = DEFAULT_LANG;

// Blockly core UI messages (context menus, trashcan, prompts), per app language. Typed by
// `Lang` (from SUPPORTED_LANGS), so a new language does not compile until its
// `blockly/msg/<lang>` import is added here. Blockly's own locale files are complete: its
// build fills untranslated keys with English, so there is no gap to fall back over.
export const BLOCKLY_CORE_MESSAGES: Record<Lang, Record<string, string>> = {
  es: blocklyEs as unknown as Record<string, string>,
  en: blocklyEn as unknown as Record<string, string>,
};

/**
 * Register a block family: define its blocks, attach its generators to the shared
 * ArduinoGenerator, and load its messages for the current language (see {@link applyLocale}).
 * Registering the same
 * family object again is a no-op (HMR, repeated test setup).
 */
export function registerFamily(family: BlockFamily): void {
  const existing = families.get(family.id);
  if (existing === family) return;
  if (existing) throw new Error(`Block family "${family.id}" is already registered`);

  const external = family.externalBlocks ?? [];
  const declared = new Set([...family.blocks.map((def) => def.type), ...external]);
  for (const type of declared) {
    const owner = blockOwners.get(type);
    if (owner) {
      throw new Error(`Block "${type}" of family "${family.id}" is owned by "${owner}"`);
    }
    if (!family.generators[type]) {
      throw new Error(`Block "${type}" of family "${family.id}" has no generator`);
    }
  }
  for (const type of external) {
    if (family.blocks.some((def) => def.type === type)) {
      throw new Error(`Block "${type}" of family "${family.id}" is both defined and external`);
    }
    // External blocks come from elsewhere (blockly/blocks); they must already be defined.
    if (!Blockly.Blocks[type]) {
      throw new Error(`External block "${type}" of family "${family.id}" is not defined`);
    }
  }
  // A generator for a block the family doesn't declare could overwrite another family's.
  for (const type of Object.keys(family.generators)) {
    if (!declared.has(type)) {
      throw new Error(`Generator "${type}" of family "${family.id}" has no block in that family`);
    }
  }

  const extensions = Object.entries(family.extensions ?? {});
  for (const [name] of extensions) {
    if (Blockly.Extensions.isRegistered(name)) {
      throw new Error(`Extension "${name}" of family "${family.id}" is already registered`);
    }
  }

  for (const type of declared) blockOwners.set(type, family.id);
  for (const [name, extension] of extensions) Blockly.Extensions.register(name, extension);
  Blockly.defineBlocksWithJsonArray(family.blocks);
  for (const [type, generate] of Object.entries(family.generators)) {
    arduinoGenerator.forBlock[type] = generate;
  }
  families.set(family.id, family);
  // Blocks resolve their %{BKY_…} labels when created, so the messages must exist now.
  applyFamilyMessages(family, currentLang);
}

/** `es` first, then `lang` over it: a key `lang` lacks keeps its `es` text (dev builds warn). */
function applyFamilyMessages(family: BlockFamily, lang: Lang): void {
  const source = family.messages[DEFAULT_LANG];
  const translated = family.messages[lang];
  if (lang !== DEFAULT_LANG) {
    for (const key of Object.keys(source)) {
      if (translated[key] === undefined) warnMissingTranslation(`family "${family.id}"`, lang, key);
    }
  }
  Blockly.setLocale({ ...source, ...translated });
}

export function registeredFamilies(): BlockFamily[] {
  return [...families.values()];
}

/**
 * Load Blockly's core messages and every family's messages for `lang` into Blockly.Msg.
 * Missing family keys fall back to `es` (_config/i18n.md). Call before creating blocks or
 * injecting a workspace; already-rendered blocks keep their old labels.
 */
export function applyLocale(lang: Lang): void {
  currentLang = lang;
  Blockly.setLocale(BLOCKLY_CORE_MESSAGES[lang]);
  for (const family of families.values()) applyFamilyMessages(family, lang);
}

/** Drop `fullOnly` items unless the profile is `full`, and strip that key (Blockly's JSON lacks it). */
function filterToolbox(items: ToolboxItem[], profile: ToolboxProfile): ToolboxItem[] {
  const result: ToolboxItem[] = [];
  for (const item of items) {
    if (item.kind === 'sep') {
      result.push(item);
      continue;
    }
    const { fullOnly, ...rest } = item;
    if (fullOnly && profile !== 'full') continue;
    if (rest.kind === 'category') {
      const contents = filterToolbox(rest.contents, profile);
      // A static category left without blocks would open an empty flyout.
      if (!rest.custom && !contents.some((child) => child.kind !== 'sep')) continue;
      result.push({ ...rest, contents });
    } else {
      result.push(rest);
    }
  }
  return result;
}

/**
 * Category toolbox assembled from the registered families, in registration order. The
 * `starter` profile (default) hides `fullOnly` items; see docs/adr/0001-starter-toolbox.md.
 */
export function buildToolbox(
  profile: ToolboxProfile = 'starter',
): Blockly.utils.toolbox.ToolboxInfo {
  const contents: ToolboxItem[] = registeredFamilies().flatMap((family) =>
    Array.isArray(family.toolbox) ? family.toolbox : [family.toolbox],
  );
  // Our toolbox types are a strict subset of Blockly's JSON toolbox format; Blockly's own
  // interfaces require every optional key to be present, hence the cast.
  return {
    kind: 'categoryToolbox',
    contents: filterToolbox(contents, profile),
  } as unknown as Blockly.utils.toolbox.ToolboxInfo;
}
