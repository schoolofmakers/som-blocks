import { describe, expect, it } from 'vitest';
import { goldenFixtureNames, runGolden } from './harness';

const fixtures = goldenFixtureNames();

describe('golden: workspace JSON → .ino', () => {
  it('has the baseline fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining(['empty', 'raw-chain', 'raw-include-and-statement']),
    );
  });

  it.each(fixtures)('%s', async (name) => {
    await runGolden(name);
  });
});
