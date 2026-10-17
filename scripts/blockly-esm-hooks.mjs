// Node module-resolution hook for scripts that import our block families outside the browser.
//
// Under Node, Blockly's package exports send `blockly/core` and `blockly/blocks` to CommonJS
// wrappers (`core-node.js`, `blocks_compressed.js`) whose `module.exports = Blockly` hides the
// named exports from ESM importers, so `import * as Blockly from 'blockly/core'` sees no
// `CodeGenerator`. Vite and Vitest pick Blockly's ESM entries instead; this hook does the same
// for `tsx` scripts. Registered from scripts/check-i18n.ts via `module.register`.

const ESM_ENTRIES = {
  'blockly/core': 'blockly.mjs',
  'blockly/blocks': 'blocks.mjs',
};

export async function resolve(specifier, context, nextResolve) {
  const entry = ESM_ENTRIES[specifier];
  if (!entry) return nextResolve(specifier, context);
  // The .mjs entries sit next to the CommonJS wrapper Node would pick, at the package root.
  const commonJs = await nextResolve(specifier, context);
  return nextResolve(new URL(entry, commonJs.url).href, context);
}
