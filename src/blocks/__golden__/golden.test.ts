import { afterEach, describe, expect, it } from 'vitest';
import { esp32c3SuperMini } from '../../boards/definitions/esp32c3-supermini';
import { uno } from '../../boards/definitions/uno';
import { setPinProfile, type PinProfile } from '../pins';
import { registerFamily } from '../registry';
import { goldenFixtureNames, runGolden } from './harness';
import { goldenLiteralsFamily } from './test-support';

const fixtures = goldenFixtureNames();

// Board each fixture is generated for; fixtures not listed use the Arduino UNO.
const FIXTURE_PROFILES: Record<string, PinProfile> = {
  'io-builtin-led-c3': esp32c3SuperMini.pins,
};

registerFamily(goldenLiteralsFamily);

afterEach(() => {
  setPinProfile(uno.pins);
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
    setPinProfile(FIXTURE_PROFILES[name] ?? uno.pins);
    await runGolden(name);
  });
});
