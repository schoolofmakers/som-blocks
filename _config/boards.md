# Boards — som-blocks

Boards are data. Each entry: id, display name, fqbn (with fixed options), upload tool + protocol, pin profile (digital, analog, PWM, i2c, spi, uart), USB filters (vendorId/productId), default baud, notes.

## v1
| id | name | fqbn | upload | USB filters | notes |
|---|---|---|---|---|---|
| esp32c3-supermini | ESP32-C3 SuperMini | esp32:esp32:esp32c3:CDCOnBoot=cdc | esptool-js | 0x303a (Espressif USB-JTAG/serial) | first-class target; WiFi, BLE, ESP-NOW. Verify `CDCOnBoot` option name against the installed core. |
| uno | Arduino UNO | arduino:avr:uno | avrgirl `uno` (stk500v1, 115200) | 0x2341:0x0043/0x0001/0x0243, 0x2a03:0x0043, 0x1a86:0x7523 (CH340) | verified 2026-10-16 (compile) |
| nano-old | Arduino NANO (bootloader viejo) | arduino:avr:nano:cpu=atmega328old | avrgirl `nano` (stk500v1, 57600) | 0x1a86:0x7523 (CH340), 0x0403:0x6001 (FTDI) | verified 2026-10-16 on hardware |

## Later / open
- SoM NANO-C (own EasyEDA Nano clone): same as nano-old or nano-new depending on bootloader; CH340 VID/PID.
- Generic ESP32 (`esp32:esp32:esp32`), ESP8266 NodeMCU (`esp8266:esp8266:nodemcuv2`).
- "Add a board" UI reading this registry is a v1 stretch; the data shape must allow it from day one.
