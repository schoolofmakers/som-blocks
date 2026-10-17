import { afterEach, describe, expect, it } from 'vitest';
import { esp32c3SuperMini } from '../../boards/definitions/esp32c3-supermini';
import { uno } from '../../boards/definitions/uno';
import type { BoardDefinition } from '../../boards/types';
import { setCurrentChip, setPinProfile } from '../pins';
import { goldenFixtureNames, runGolden } from './harness';

const fixtures = goldenFixtureNames();

// Board each fixture is generated for; fixtures not listed use the Arduino UNO.
const FIXTURE_BOARDS: Record<string, BoardDefinition> = {
  'io-builtin-led-c3': esp32c3SuperMini,
  'ble-start-send': esp32c3SuperMini,
  'ble-on-receive-echo': esp32c3SuperMini,
  'wifi-connect-and-ip': esp32c3SuperMini,
  'wifi-http-get-print': esp32c3SuperMini,
  'espnow-name-send-all': esp32c3SuperMini,
  'espnow-send-to-and-receive-echo': esp32c3SuperMini,
};

function selectBoard(board: BoardDefinition): void {
  setPinProfile(board.pins);
  setCurrentChip(board.chip);
}

afterEach(() => {
  selectBoard(uno);
});

describe('golden: workspace JSON → .ino', () => {
  it('has the baseline fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining([
        'empty',
        'raw-chain',
        'raw-include-and-statement',
        // One per core family (B3).
        'logic-if-else',
        'control-loops',
        'math-map-random',
        'text-join-append',
        'variables-typed',
        'lists-array',
        'lists-unsupported',
        'functions-prototypes',
        'edge-cases',
      ]),
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

  it('has the ble fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining(['ble-start-send', 'ble-on-receive-echo', 'ble-on-avr-error']),
    );
  });

  it('has the wifi fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining(['wifi-connect-and-ip', 'wifi-http-get-print', 'wifi-on-avr-error']),
    );
  });

  it('has the espnow fixtures', () => {
    expect(fixtures).toEqual(
      expect.arrayContaining([
        'espnow-name-send-all',
        'espnow-send-to-and-receive-echo',
        'espnow-on-avr-error',
      ]),
    );
  });

  it.each(fixtures)('%s', async (name) => {
    selectBoard(FIXTURE_BOARDS[name] ?? uno);
    await runGolden(name);
  });
});
