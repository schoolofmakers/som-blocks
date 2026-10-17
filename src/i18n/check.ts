// Core of `pnpm i18n:check` (scripts/check-i18n.ts does the file and module loading). Pure
// so it can be tested against fixtures. _config/i18n.md → "CI check" describes the rules.
//
// Pattern: google/blockly packages/blockly/core/utils/parsing.ts `checkMessageReferences`
// finds `%{BKY_…}` references with /%{BKY_[A-Z]\w*}/gi and warns when Blockly.Msg lacks one.
// Difference: we run that at CI time over every registered family (blocks + toolbox) instead
// of at runtime, and add the per-language key-set and dead-key checks Blockly leaves to its
// translation pipeline (its build fills untranslated keys with English and marks them).

export interface I18nCheckFamily {
  id: string;
  /** One dictionary per language, as in a block family's `messages`. */
  messages: Record<string, Record<string, string>>;
  /** Block definitions and toolbox, searched for `%{BKY_…}` references. */
  blocks: unknown;
  toolbox: unknown;
}

export interface I18nCheckInput {
  /** Supported languages; the first one is the source language (`es`). */
  langs: readonly string[];
  /** UI dictionaries per language (`src/i18n/messages.ts`). */
  ui: Record<string, Record<string, string | undefined>>;
  families: readonly I18nCheckFamily[];
  /** Blockly's own message keys (from `blockly/msg/<source>`): always resolvable. */
  coreKeys: ReadonlySet<string>;
  /** Every source file where a key may be used (src/ and e2e/). */
  sources: readonly { path: string; text: string }[];
}

export type I18nFinding =
  | { kind: 'missing'; scope: string; lang: string; key: string }
  | { kind: 'extra'; scope: string; lang: string; key: string }
  | { kind: 'dead'; scope: string; key: string }
  | { kind: 'unresolved'; scope: string; key: string };

/** Blockly's message-reference syntax; the key is matched case-insensitively, like Blockly. */
const BKY_REFERENCE = /%\{BKY_([A-Z]\w*)\}/gi;
/** A key written as a whole string literal: 'KEY', "KEY" or `KEY`. */
const KEY_LITERAL = /(['"`])([A-Z][A-Z0-9_]*)\1/g;

function bkyReferences(text: string): string[] {
  return [...text.matchAll(BKY_REFERENCE)].map((match) => (match[1] ?? '').toUpperCase());
}

/**
 * Every key mentioned anywhere in the sources, as a string literal or a `%{BKY_…}`
 * reference. Conservative on purpose: a key in a test, a comment string or another family
 * still counts as used, so the dead-key check only flags keys nothing names at all.
 */
function usedKeys(sources: I18nCheckInput['sources']): Set<string> {
  const used = new Set<string>();
  for (const { text } of sources) {
    for (const match of text.matchAll(KEY_LITERAL)) used.add(match[2] ?? '');
    for (const key of bkyReferences(text)) used.add(key);
  }
  return used;
}

function keysOf(dict: Record<string, string | undefined> | undefined): Set<string> {
  return new Set(Object.keys(dict ?? {}).filter((key) => dict?.[key] !== undefined));
}

function compareKeySets(
  scope: string,
  langs: readonly string[],
  dicts: Record<string, Record<string, string | undefined>>,
  findings: I18nFinding[],
): void {
  const [source, ...others] = langs;
  const sourceKeys = keysOf(dicts[source ?? '']);
  for (const lang of others) {
    const keys = keysOf(dicts[lang]);
    for (const key of sourceKeys) {
      if (!keys.has(key)) findings.push({ kind: 'missing', scope, lang, key });
    }
    for (const key of keys) {
      if (!sourceKeys.has(key)) findings.push({ kind: 'extra', scope, lang, key });
    }
  }
}

export function checkI18n(input: I18nCheckInput): I18nFinding[] {
  const findings: I18nFinding[] = [];
  const source = input.langs[0] ?? '';
  const used = usedKeys(input.sources);

  compareKeySets('UI', input.langs, input.ui, findings);
  for (const key of keysOf(input.ui[source])) {
    if (!used.has(key)) findings.push({ kind: 'dead', scope: 'UI', key });
  }

  for (const family of input.families) {
    const scope = `family "${family.id}"`;
    compareKeySets(scope, input.langs, family.messages, findings);
    const own = keysOf(family.messages[source]);
    for (const key of own) {
      // A family may override one of Blockly's own messages; Blockly's blocks use it.
      if (!used.has(key) && !input.coreKeys.has(key)) findings.push({ kind: 'dead', scope, key });
    }
    const references = new Set(bkyReferences(JSON.stringify([family.blocks, family.toolbox])));
    for (const key of references) {
      if (!own.has(key) && !input.coreKeys.has(key)) {
        findings.push({ kind: 'unresolved', scope, key });
      }
    }
  }
  return findings;
}

const HEADINGS: Record<I18nFinding['kind'], string> = {
  missing: 'Missing translations (the source language has the key, this language does not)',
  extra: 'Keys only in a translation (not in the source language)',
  dead: 'Unused keys (no string literal or %{BKY_…} reference anywhere in src/ or e2e/)',
  unresolved: '%{BKY_…} references with no message (in a block definition or toolbox)',
};

/** Human-readable report, grouped by kind; empty string when there are no findings. */
export function formatFindings(findings: readonly I18nFinding[]): string {
  const lines: string[] = [];
  for (const kind of Object.keys(HEADINGS) as I18nFinding['kind'][]) {
    const group = findings.filter((finding) => finding.kind === kind);
    if (group.length === 0) continue;
    lines.push(`${HEADINGS[kind]}:`);
    for (const finding of group) {
      const lang = 'lang' in finding ? ` [${finding.lang}]` : '';
      lines.push(`  - ${finding.scope}${lang}: ${finding.key}`);
    }
  }
  return lines.join('\n');
}
