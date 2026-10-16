import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  disposeTestWorkspace,
  generate,
  num,
  setupBody,
  stack,
  type BlockState,
} from '../__golden__/test-support';
import { uno } from '../../boards/definitions/uno';
import { registerBuiltInFamilies } from '../index';
import { setPinProfile } from '../pins';
import { applyLocale } from '../registry';

beforeAll(() => {
  registerBuiltInFamilies();
  applyLocale('es');
  setPinProfile(uno.pins); // the analogRead(A0) case needs an AVR pin list
});

afterEach(() => {
  disposeTestWorkspace();
});

const println = (value?: BlockState): BlockState => ({
  type: 'som_serial_println',
  ...(value ? { inputs: { VALUE: { block: value } } } : {}),
});
const begin = (baud: string): BlockState => ({ type: 'som_serial_begin', fields: { BAUD: baud } });

describe('time', () => {
  it('empty inputs fall back to 0', () => {
    const code = generate(stack({ type: 'som_time_delay_ms' }, { type: 'som_time_delay_s' }));
    expect(code).toContain('delay(0);\n  delay((unsigned long)(0 * 1000.0));');
  });

  it('delay in seconds converts to whole milliseconds', () => {
    const code = generate({ type: 'som_time_delay_s', inputs: { SECONDS: { block: num(1.5) } } });
    expect(code).toContain('delay((unsigned long)(1.5 * 1000.0));');
  });

  it('integer seconds multiply in floating point (no 16-bit int overflow on AVR)', () => {
    // analogRead() is an int; `int * 1000` overflows above 32 on UNO/NANO.
    const code = generate({
      type: 'som_time_delay_s',
      inputs: { SECONDS: { block: { type: 'som_io_analog_read', fields: { PIN: 'A0' } } } },
    });
    expect(code).toContain('delay((unsigned long)(analogRead(A0) * 1000.0));');
  });

  it('every N ms: one static timer per block, non-blocking check in loop', () => {
    const every = (ms: number): BlockState => ({
      type: 'som_time_every',
      inputs: { MS: { block: num(ms) } },
    });
    const code = generate(stack(every(100), every(200)));
    expect(code).toContain(
      'static unsigned long som_every = 0;\nstatic unsigned long som_every2 = 0;',
    );
    expect(code).toContain('if (millis() - som_every >= 100) {\n    som_every = millis();\n  }');
    expect(code).toContain('if (millis() - som_every2 >= 200) {');
    expect(code).not.toContain('delay(');
  });

  it('every N ms timers reset between generations', () => {
    const every: BlockState = { type: 'som_time_every', inputs: { MS: { block: num(5) } } };
    generate(every);
    expect(generate(every)).not.toContain('som_every2');
  });
});

describe('serial', () => {
  it('Serial.begin goes to setup with the chosen baud', () => {
    const code = generate(stack(begin('9600'), println(num(1))));
    expect(setupBody(code)).toEqual(['Serial.begin(9600);']);
    expect(code).toContain('void loop() {\n  Serial.println(1);\n}');
  });

  it('the begin block wins even when generated after a print', () => {
    const code = generate(stack(println(num(1)), begin('57600')));
    expect(setupBody(code)).toEqual(['Serial.begin(57600);']);
  });

  it('a print without a begin block still starts the port at 115200', () => {
    const code = generate(println(num(1)));
    expect(setupBody(code)).toEqual(['Serial.begin(115200);']);
  });

  it('a disabled begin block does not count', () => {
    const code = generate({ ...begin('9600'), enabled: false }, println(num(1)));
    expect(setupBody(code)).toEqual(['Serial.begin(115200);']);
  });

  it('available and read line', () => {
    const code = generate(
      println({ type: 'som_serial_read_line' }),
      println({ type: 'som_serial_available' }),
    );
    expect(code).toContain("Serial.println(Serial.readStringUntil('\\n'));");
    expect(code).toContain('Serial.println(Serial.available() > 0);');
  });

  it('plot prints label:value and sanitises the label for the plotter', () => {
    const code = generate({
      type: 'som_serial_plot',
      fields: { LABEL: ' mi "luz": 1,2 ' },
      inputs: { VALUE: { block: num(7) } },
    });
    expect(code).toContain('Serial.print("mi_luz_1_2:");\n  Serial.println(7);');
  });

  it('plot with an empty label still prints a valid series name', () => {
    const code = generate({ type: 'som_serial_plot', fields: { LABEL: '' } });
    expect(code).toContain('Serial.print("value:");\n  Serial.println(0);');
  });
});
