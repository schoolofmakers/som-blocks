// Pin profile seam shared by the board registry (B5) and the pin dropdown blocks (B4).
// Blocks read the selected board's pins through `currentPinProfile()`; the board store
// calls `setPinProfile()` whenever the selected board changes. Whichever of B4/B5 lands
// second rebases onto this file and keeps one copy.
import { esp32c3SuperMini } from '../boards/definitions/esp32c3-supermini';

/** A dropdown entry: what the student sees, and the value the generator emits. */
export type PinOption = readonly [label: string, value: string];

export interface PinProfile {
  digital: readonly PinOption[];
  analog: readonly PinOption[];
  pwm: readonly PinOption[];
  /** Value (as emitted in code) of the on-board LED pin. Never `LED_BUILTIN` on the C3. */
  builtinLed: string;
  /** True when writing LOW turns the on-board LED on (C3 SuperMini GPIO 8). */
  builtinLedActiveLow: boolean;
  /** Largest `analogRead` value: 1023 on AVR (10-bit), 4095 on the C3 (12-bit). */
  analogMax: number;
  /** Default bus pins of the Arduino core variant (what `Wire.begin()`, `SPI.begin()` and
   * `Serial` use with no arguments). Values as emitted in code. */
  i2c: { sda: string; scl: string };
  spi: { mosi: string; miso: string; sck: string; ss: string };
  uart: { rx: string; tx: string };
}

let current: PinProfile = esp32c3SuperMini.pins;

/** The selected board's pin profile. Defaults to the ESP32-C3 SuperMini. */
export function currentPinProfile(): PinProfile {
  return current;
}

export function setPinProfile(profile: PinProfile): void {
  current = profile;
}
