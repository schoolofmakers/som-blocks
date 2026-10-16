import * as Blockly from 'blockly/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  disposeTestWorkspace,
  generate,
  goldenLiteralsFamily,
  load,
  setupBody,
  stack,
  type BlockState,
} from '../__golden__/test-support';
import { registerBuiltInFamilies } from '../index';
import { esp32c3SuperMini } from '../../boards/definitions/esp32c3-supermini';
import { uno } from '../../boards/definitions/uno';
import { setPinProfile } from '../pins';
import { applyLocale, registerFamily } from '../registry';

const write = (pin: string, state = 'HIGH'): BlockState => ({
  type: 'som_io_digital_write',
  fields: { PIN: pin, STATE: state },
});
const read = (pin: string): BlockState => ({ type: 'som_io_digital_read', fields: { PIN: pin } });
const led = (state: 'ON' | 'OFF'): BlockState => ({
  type: 'som_io_builtin_led',
  fields: { STATE: state },
});

beforeAll(() => {
  registerBuiltInFamilies();
  registerFamily(goldenLiteralsFamily);
  applyLocale('es');
  // Tests below assume the UNO unless they switch board (the app default is the C3).
  setPinProfile(uno.pins);
});

afterEach(() => {
  disposeTestWorkspace();
  setPinProfile(uno.pins);
});

describe('io: pinMode keyed by pin', () => {
  it('writes one pinMode line per pin, however many blocks use it', () => {
    const code = generate(stack(write('13'), write('13', 'LOW'), write('7')));
    expect(setupBody(code)).toEqual(['pinMode(13, OUTPUT);', 'pinMode(7, OUTPUT);']);
  });

  it('reads configure INPUT, in generation order', () => {
    const code = generate(
      stack(write('7'), { type: 'som_serial_println', inputs: { VALUE: { block: read('2') } } }),
    );
    expect(setupBody(code)).toEqual([
      'pinMode(7, OUTPUT);',
      'Serial.begin(115200);',
      'pinMode(2, INPUT);',
    ]);
    expect(code).toContain('Serial.println(digitalRead(2));');
  });

  it('a pin used as input and output keeps the last mode and gets a TODO conflict', () => {
    const code = generate(
      stack(write('4'), { type: 'som_serial_println', inputs: { VALUE: { block: read('4') } } }),
    );
    expect(setupBody(code)).toEqual([
      'pinMode(4, INPUT); // TODO conflict: pin 4 is used as input and output; the last block wins',
      'Serial.begin(115200);',
    ]);
  });

  it('the conflict note follows generation order (output last → OUTPUT)', () => {
    const code = generate(
      stack({ type: 'som_serial_println', inputs: { VALUE: { block: read('4') } } }, write('4')),
    );
    expect(setupBody(code)).toContain(
      'pinMode(4, OUTPUT); // TODO conflict: pin 4 is used as input and output; the last block wins',
    );
  });

  it('a disabled block takes no part in the conflict check', () => {
    // The read sits inside a disabled print, so it never reaches the sketch.
    const code = generate(write('4'), {
      type: 'som_serial_println',
      enabled: false,
      inputs: { VALUE: { block: read('4') } },
    });
    expect(setupBody(code)).toContain('pinMode(4, OUTPUT);');
    expect(code).not.toContain('TODO conflict');
  });

  it('analogRead needs no pinMode', () => {
    const code = generate({
      type: 'som_serial_println',
      inputs: { VALUE: { block: { type: 'som_io_analog_read', fields: { PIN: 'A0' } } } },
    });
    expect(code).not.toContain('pinMode');
    expect(code).toContain('Serial.println(analogRead(A0));');
  });
});

describe('io: built-in LED follows the pin profile', () => {
  it('UNO: pin 13, active-high', () => {
    const code = generate(stack(led('ON'), led('OFF')));
    expect(code).toContain('pinMode(13, OUTPUT);');
    expect(code).toContain('digitalWrite(13, HIGH);\n  digitalWrite(13, LOW);');
  });

  it('C3 SuperMini: GPIO 8, active-low, never LED_BUILTIN', () => {
    setPinProfile(esp32c3SuperMini.pins);
    const code = generate(stack(led('ON'), led('OFF')));
    expect(code).toContain('pinMode(8, OUTPUT);');
    expect(code).toContain('digitalWrite(8, LOW);\n  digitalWrite(8, HIGH);');
    expect(code).not.toContain('LED_BUILTIN');
  });

  it('shares the pin key with a digital write on the same pin', () => {
    const code = generate(stack(led('ON'), write('13')));
    expect(setupBody(code)).toEqual(['pinMode(13, OUTPUT);']);
  });
});

describe('io: dropdowns and tooltips read the active profile', () => {
  it('pin dropdowns list the profile pins', () => {
    setPinProfile(esp32c3SuperMini.pins);
    const ws = load({ type: 'som_io_analog_read' }, { type: 'som_io_digital_write' });
    const [analog, digital] = ws.getTopBlocks(true);
    const values = (b: Blockly.Block | undefined) =>
      (b?.getField('PIN') as Blockly.FieldDropdown).getOptions(false).map((o) => o[1]);
    expect(values(analog)).toEqual(['0', '1', '2', '3', '4']);
    expect(values(digital)).toContain('21');
    expect(values(digital)).not.toContain('13');
  });

  it('analogRead tooltip states the board maximum (1023 AVR, 4095 ESP32)', () => {
    const ws = load({ type: 'som_io_analog_read' });
    const block = ws.getTopBlocks(false)[0];
    const tooltip = () => {
      const t = block?.tooltip;
      return typeof t === 'function' ? t() : t;
    };
    expect(tooltip()).toContain('1023');
    setPinProfile(esp32c3SuperMini.pins);
    expect(tooltip()).toContain('4095');
    expect(tooltip()).not.toContain('1023');
  });
});
