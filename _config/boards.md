# Boards — som-blocks

Boards are data. Each entry: id, display name, fqbn (with fixed options), upload tool + protocol, pin profile (digital, analog, PWM, i2c, spi, uart), USB filters (vendorId/productId), default baud, notes.

## v1
| id | name | fqbn | upload | USB filters | notes |
|---|---|---|---|---|---|
| esp32c3-supermini | ESP32-C3 SuperMini | esp32:esp32:esp32c3:CDCOnBoot=cdc | esptool-js | 0x303a (Espressif USB-JTAG/serial) | first-class target; WiFi, BLE, ESP-NOW. Options verified on our server image (core 3.3.12), see below. |
| uno | Arduino UNO | arduino:avr:uno | avrgirl `uno` (stk500v1, 115200) | 0x2341:0x0043/0x0001/0x0243, 0x2a03:0x0043, 0x1a86:0x7523 (CH340) | verified 2026-10-16 (compile) |
| nano-old | Arduino NANO (bootloader viejo) | arduino:avr:nano:cpu=atmega328old | avrgirl `nano` (stk500v1, 57600) | 0x1a86:0x7523 (CH340), 0x0403:0x6001 (FTDI) | verified 2026-10-16 on hardware |

## Later / open
- SoM NANO-C (own EasyEDA Nano clone): same as nano-old or nano-new depending on bootloader; CH340 VID/PID.
- Generic ESP32 (`esp32:esp32:esp32`), ESP8266 NodeMCU (`esp8266:esp8266:nodemcuv2`).
- "Add a board" UI reading this registry is a v1 stretch; the data shape must allow it from day one.

## ESP32-C3 facts from our compile server (A1, core esp32 3.3.12, 2026-10-16)
`config_options` for `esp32:esp32:esp32c3` ("ESP32C3 Dev Module"; * = default):
UploadSpeed 921600*/115200/230400/460800 · CDCOnBoot default*/cdc · CPUFreq 160*/80/40/20/10 · FlashFreq 80*/40 · FlashMode qio*/dio ·
FlashSize 4M*/8M/2M/16M · PartitionScheme default*/… (incl. huge_app, min_spiffs, no_ota) · DebugLevel none*/… · EraseFlash none*/all · JTAGAdapter default*/builtin/external/bridge · ZigbeeMode default*/zczr.
- Compile of a blink for the C3 took ~27 s on the local emulated image and returned 4 images, `flash_freq` 80m, `flash_mode` qio.
- **Bootloader address rule:** the server returns the C3 bootloader image at `0x1000`, which is wrong (upstream does `Number(bootloader_addr) || 0x1000`, and the C3's correct address is `0x0`; same for S3/C6). The browser flasher (B8) takes the bootloader address from this registry per chip and ignores the server's value for that image: `esp32` → 0x1000; `esp32c3`, `esp32s3`, `esp32c6` → 0x0.
- **Flash params rule:** the flasher must use `keep` for flash mode, frequency and size, never the server's `flash_mode`/`flash_freq`. Those come from `build.boot` (qio/80m), while arduino-esp32 builds the C3 bootloader header as DIO on purpose (`menu.FlashMode.qio.build.flash_mode=dio`, `build.boot=qio`; the bootloader switches to QIO itself) and uploads with `--flash_mode keep --flash_freq keep --flash_size keep`. Verified on a real SuperMini (2026-10-17): the server's qio/80m rewrite of the header bricks the C3's boot (`mode:QIO … ets_loader.c 78`, TG0WDT reset loop); reflashing with keep fixes it.
- `LED_BUILTIN` on the generic esp32c3 variant is an RGB pseudo-pin, not GPIO 8. The SuperMini's blue LED is GPIO 8 (active-low on many units); the io family must use the registry's `builtinLed` pin, never `LED_BUILTIN`.
- Partition scheme for the WiFi-OTA path (Track D) must keep two OTA slots; `default` does (ota_0/ota_1 1.25 MB each). `huge_app`/`no_ota` break OTA.
