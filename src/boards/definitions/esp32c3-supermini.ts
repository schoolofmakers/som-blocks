import type { BoardDefinition } from '../types';

// Source: _config/boards.md, `esp32c3-supermini` row and "ESP32-C3 facts from our compile
// server" (core esp32 3.3.12). GPIO 11–17 are the SPI flash and 18/19 are USB D-/D+, so
// the SuperMini breaks out GPIO 0–10, 20 and 21 only.
export const esp32c3SuperMini: BoardDefinition = {
  id: 'esp32c3-supermini',
  name: 'ESP32-C3 SuperMini',
  fqbn: 'esp32:esp32:esp32c3',
  // USB CDC on boot so Serial goes out the native USB port the SuperMini is plugged into.
  options: { CDCOnBoot: 'cdc' },
  chip: 'esp32c3',
  // 921600 is the core's UploadSpeed default; the C3 is native USB-CDC so it is nominal.
  upload: { tool: 'esptool', baud: 921600, bootloaderAddress: 0x0 },
  usbFilters: [{ usbVendorId: 0x303a }],
  pins: {
    digital: [
      ['GPIO0', '0'],
      ['GPIO1', '1'],
      ['GPIO2', '2'],
      ['GPIO3', '3'],
      ['GPIO4', '4'],
      ['GPIO5', '5'],
      ['GPIO6', '6'],
      ['GPIO7', '7'],
      ['GPIO8', '8'],
      ['GPIO9', '9'],
      ['GPIO10', '10'],
      ['GPIO20', '20'],
      ['GPIO21', '21'],
    ],
    // ADC1 channels 0–4. (GPIO5 is ADC2, unusable while WiFi is on, so it is left out.)
    analog: [
      ['GPIO0', '0'],
      ['GPIO1', '1'],
      ['GPIO2', '2'],
      ['GPIO3', '3'],
      ['GPIO4', '4'],
    ],
    // LEDC drives PWM on any output GPIO.
    pwm: [
      ['GPIO0', '0'],
      ['GPIO1', '1'],
      ['GPIO2', '2'],
      ['GPIO3', '3'],
      ['GPIO4', '4'],
      ['GPIO5', '5'],
      ['GPIO6', '6'],
      ['GPIO7', '7'],
      ['GPIO8', '8'],
      ['GPIO9', '9'],
      ['GPIO10', '10'],
      ['GPIO20', '20'],
      ['GPIO21', '21'],
    ],
    // Blue LED on GPIO 8, active-low on many units. Not LED_BUILTIN, which on the generic
    // esp32c3 variant is an RGB pseudo-pin.
    builtinLed: '8',
    builtinLedActiveLow: true,
    analogMax: 4095,
    // Core defaults from arduino-esp32 variants/esp32c3/pins_arduino.h. SDA shares GPIO 8
    // with the LED on the SuperMini.
    i2c: { sda: '8', scl: '9' },
    spi: { mosi: '6', miso: '5', sck: '4', ss: '7' },
    uart: { rx: '20', tx: '21' },
  },
  notes:
    'GPIO 2, 8 and 9 are strapping pins (GPIO 9 is the BOOT button). GPIO 20/21 are UART0 RX/TX.',
};
