import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PIN_PROFILE, setPinProfile, type PinProfile } from '../pins';
import { registerFamily } from '../registry';
import { goldenFixtureNames, runGolden } from './harness';
import { C3_LIKE_PROFILE, goldenLiteralsFamily } from './test-support';

const fixtures = goldenFixtureNames();

// Fixtures generated with a board other than the default (UNO-like) pin profile.
const FIXTURE_PROFILES: Record<string, PinProfile> = {
  'io-builtin-led-c3': C3_LIKE_PROFILE,
};

registerFamily(goldenLiteralsFamily);

afterEach(() => {
  setPinProfile(DEFAULT_PIN_PROFILE);
});

describe('golden: workspace JSON → .ino', () => {
  it('has the baseline fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining(['empty', 'raw-chain', 'raw-include-and-statement']),
    );
  });

  it('has the io / time / serial fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining([
        'io-blink',
        'io-analog-to-serial',
        'io-builtin-led-c3',
        'time-every',
        'serial-begin-baud',
      ]),
    );
  });

  it.each(fixtures)('%s', async (name) => {
    setPinProfile(FIXTURE_PROFILES[name] ?? DEFAULT_PIN_PROFILE);
    await runGolden(name);
  });
});
