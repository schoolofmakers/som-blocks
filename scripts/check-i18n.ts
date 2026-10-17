// `pnpm i18n:check`: fails when the UI or block-family dictionaries disagree across languages,
// when a key is unused, or when a block/toolbox `%{BKY_…}` reference has no message. The rules
// live in src/i18n/check.ts; this file only loads the modules and the sources.
//
// Runs under `tsx`. The resolve hook gives Node Blockly's ESM entries, which the families'
// `import * as Blockly from 'blockly/core'` needs (see scripts/blockly-esm-hooks.mjs).

import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

register('./blockly-esm-hooks.mjs', import.meta.url);

const { BUILT_IN_FAMILIES } = await import('../src/blocks/index');
const { BLOCKLY_CORE_MESSAGES } = await import('../src/blocks/registry');
const { checkI18n, formatFindings } = await import('../src/i18n/check');
const { DEFAULT_LANG, SUPPORTED_LANGS, UI_MESSAGES } = await import('../src/i18n/messages');

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DIRS = ['src', 'e2e'];
const SOURCE_FILE = /\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

const sources = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(root, dir))).map((path) => ({
  path: relative(root, path),
  text: readFileSync(path, 'utf8'),
}));

// The source language first: it is the reference key set and the fallback.
const langs = [DEFAULT_LANG, ...SUPPORTED_LANGS.filter((lang) => lang !== DEFAULT_LANG)];
const findings = checkI18n({
  langs,
  ui: UI_MESSAGES,
  families: BUILT_IN_FAMILIES,
  coreKeys: new Set(Object.keys(BLOCKLY_CORE_MESSAGES[DEFAULT_LANG])),
  sources,
});

const keyCount =
  Object.keys(UI_MESSAGES[DEFAULT_LANG]).length +
  BUILT_IN_FAMILIES.reduce((sum, family) => sum + Object.keys(family.messages.es).length, 0);
const summary = `${langs.join(' + ')}: ${keyCount} keys (UI + ${BUILT_IN_FAMILIES.length} block families), ${sources.length} source files`;

if (findings.length > 0) {
  console.error(`i18n check failed: ${findings.length} problem(s). ${summary}\n`);
  console.error(formatFindings(findings));
  console.error('\nSee _config/i18n.md → "CI check".');
  process.exit(1);
}
console.log(`i18n check passed. ${summary}`);
