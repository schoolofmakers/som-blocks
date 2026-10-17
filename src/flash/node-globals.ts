// avrgirl-arduino's browser bundle is a webpack build of Node code: it expects `Buffer` and
// `process` as globals (_config/architecture.md → Upload paths). Install them, from the
// `buffer` and `process` packages, before the bundle is imported, and only when missing so a
// host that has them (Node in unit tests) keeps its own.

export interface NodeGlobalsTarget {
  Buffer?: unknown;
  process?: unknown;
}

export async function installNodeGlobals(
  target: NodeGlobalsTarget = globalThis as NodeGlobalsTarget,
): Promise<void> {
  if (target.Buffer === undefined) {
    const { Buffer } = await import('buffer');
    target.Buffer = Buffer;
  }
  if (target.process === undefined) {
    const { default: process } = await import('process/browser.js');
    target.process = process;
  }
}
