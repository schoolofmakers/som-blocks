// Loaded lazily by CodeView (its own chunk): highlight.js core plus only the C++ grammar,
// BSD-3-Clause. Usage idea from microsoft/pxt pxtrunner/renderer.ts (hljs on rendered code
// snippets); we call the string API instead of highlighting DOM nodes.
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';

hljs.registerLanguage('cpp', cpp);

/**
 * C++ source as HTML with `hljs-*` spans. highlight.js escapes the text, so the result's
 * textContent equals `code` exactly.
 */
export function highlightCpp(code: string): string {
  return hljs.highlight(code, { language: 'cpp', ignoreIllegals: true }).value;
}
