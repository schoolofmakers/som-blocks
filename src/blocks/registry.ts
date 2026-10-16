import * as Blockly from 'blockly/core';
import * as blocklyEn from 'blockly/msg/en';
import * as blocklyEs from 'blockly/msg/es';
import { DEFAULT_LANG, type Lang } from '../i18n/messages';
import { arduinoGenerator } from './arduino-generator';
import type { BlockFamily, ToolboxItem } from './types';

// Family registry: the only place that writes family data into Blockly's globals
// (Blockly.Blocks, generator.forBlock, Blockly.Msg). Families stay plain data modules.

const families = new Map<string, BlockFamily>();
/** block type → owning family id, so two families can never claim the same block. */
const blockOwners = new Map<string, string>();
/** Language last passed to applyLocale; families registered later get it immediately. */
let currentLang: Lang = DEFAULT_LANG;

// Blockly core UI messages (context menus, trashcan, prompts), per app language.
const coreMessages: Record<Lang, Record<string, string>> = {
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

  for (const def of family.blocks) {
    const owner = blockOwners.get(def.type);
    if (owner) {
      throw new Error(`Block "${def.type}" of family "${family.id}" is owned by "${owner}"`);
    }
    if (!family.generators[def.type]) {
      throw new Error(`Block "${def.type}" of family "${family.id}" has no generator`);
    }
  }

  for (const def of family.blocks) blockOwners.set(def.type, family.id);
  Blockly.defineBlocksWithJsonArray(family.blocks);
  for (const [type, generate] of Object.entries(family.generators)) {
    arduinoGenerator.forBlock[type] = generate;
  }
  families.set(family.id, family);
  // Blocks resolve their %{BKY_…} labels when created, so the messages must exist now.
  applyFamilyMessages(family, currentLang);
}

function applyFamilyMessages(family: BlockFamily, lang: Lang): void {
  Blockly.setLocale({ ...family.messages[DEFAULT_LANG], ...family.messages[lang] });
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
  Blockly.setLocale(coreMessages[lang]);
  for (const family of families.values()) applyFamilyMessages(family, lang);
}

/** Category toolbox assembled from the registered families, in registration order. */
export function buildToolbox(): Blockly.utils.toolbox.ToolboxInfo {
  const contents: ToolboxItem[] = registeredFamilies().flatMap((family) =>
    Array.isArray(family.toolbox) ? family.toolbox : [family.toolbox],
  );
  // Our toolbox types are a strict subset of Blockly's JSON toolbox format; Blockly's own
  // interfaces require every optional key to be present, hence the cast.
  return { kind: 'categoryToolbox', contents } as unknown as Blockly.utils.toolbox.ToolboxInfo;
}
