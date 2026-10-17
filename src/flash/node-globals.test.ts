import { describe, expect, it } from 'vitest';
import { installNodeGlobals } from './node-globals';

describe('installNodeGlobals', () => {
  it('installs Buffer and process when missing', async () => {
    const target: { Buffer?: unknown; process?: unknown } = {};
    await installNodeGlobals(target);
    const { Buffer } = await import('buffer');
    expect(target.Buffer).toBe(Buffer);
    expect((target.process as { browser?: boolean }).browser).toBe(true);
  });

  it('keeps globals that are already there', async () => {
    const target = { Buffer: 'mine', process: 'mine too' };
    await installNodeGlobals(target);
    expect(target).toEqual({ Buffer: 'mine', process: 'mine too' });
  });
});
