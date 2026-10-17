# Flash on real boards — manual checklist (B8)

CI cannot open the browser's serial port chooser, so every flasher change is checked by hand on
real boards before merge (`_config/standards.md` → Quality gates). Put the log panel text (or a
photo/video) for each row in the PR.

## Setup

- Boards: **ESP32-C3 SuperMini** (native USB, VID 0x303a) and **Arduino NANO, old bootloader**
  (CH340, 57600 baud). UNO when one is at hand.
- Browser: desktop **Chrome or Edge** (Web Serial). Close the Arduino IDE and any other tab that
  may hold the port.
- Editor: `pnpm dev` (or the preview build) with `VITE_COMPILE_SERVER_URL` pointing at a compile
  server that has the C3 core (`server/compile`).
- Sketch: a blink on the board's LED (C3: GPIO 8, active-low; NANO: D13), plus a
  `Serial.println("hola")` in `setup()` so the boot is visible.

## Acceptance criterion (Mr.Maker)

After an upload, on both paths (AVR and ESP), the board **stays connected**: the header reads
**Conectada** and the serial monitor receives the board's output from the new program at the
monitor's baud. The connection ends only when the student presses **Desconectar**. An upload
that ends in **Sin conexión** fails this check even if the program was written.

## Happy path (each board)

1. Pick the board in **Placa**, press **Conectar** → **Conectar por USB**, choose the port.
2. Press **Compilar**, wait for "Listo …".
3. Press **Subir**. The bar goes through the phases and ends on
   "¡Listo! Tu programa ya está en la placa." The header still says **Conectada**.
4. The LED blinks with the new program.
5. Without reconnecting, open the serial monitor: `hola` (and later output) arrives, and the
   header still reads **Conectada** (acceptance criterion above).

Expected lines in the log panel, in order. These come from the libraries' source, not from a
recorded run yet: wording may differ slightly and numbers vary.

**ESP32-C3 SuperMini (esptool-js)**

```
Connecting...
Detecting chip type... ESP32-C3
Chip is ESP32-C3 (QFN32) (revision v0.4)
Features: …
MAC: …
Uploading stub...
Running stub...
Stub running...
Changing baudrate to 921600
flash params: keep (server reported mode qio, freq 80m; images keep their own headers)
Not changing the image
Writing at 0x0... (100%)
Wrote 20000 bytes (… compressed) at 0x0 in … seconds.
Writing at 0x8000... (100%)
Writing at 0xe000... (100%)
Writing at 0x10000... (…%)
Wrote … bytes (… compressed) at 0x10000 in … seconds.
Leaving...
Hard resetting via RTS pin...
reset → running your program
```

The last line is our own reset pulse (RTS high 100 ms with DTR low, then RTS low): the C3 must
start the new program **without pressing RESET**. The C3 re-enumerates on every reset, so
the header shows **Reconectando…** for a moment and then **Conectada** again by itself, and the
monitor shows the new program's output. The same happens when you press RESET on the board:
the editor reconnects by itself within a few seconds, without the port chooser.

The first `Wrote … at 0x0` line is the point of this PR: the bootloader goes to **0x0**, not
the 0x1000 the compile server sends. If it says `0x1000`, stop: the board will not boot.
There must be **no** `Flash params set to …` line: the flasher keeps the image headers. If the
bootloader header is rewritten to QIO, the C3 boot log after RESET shows
`mode:QIO … ets_loader.c 78` and a TG0WDT reset loop (seen on a real SuperMini before the fix).

**Arduino NANO old bootloader (avrgirl)**

```
connected
reset complete.
flashing, please wait...
flash complete.
```

avrgirl gives no byte progress: the bar sits at 50 % while it writes, which is expected.
When the NANO answers the first sync late (the old bootloader often does), one extra line
`drained 2 stale byte(s) after sync` appears before `flashing, please wait...`; that is the
avrdude-style drain working, not an error.

## Failure cases (each board)

| Try | How | Expected |
|---|---|---|
| Wrong board selected | C3 plugged in, **Arduino NANO** selected (and the reverse) | Upload stops with a red message: "La placa no respondió. Revisa que elegiste la placa correcta…" (the C3 message adds the BOOT/RESET hint). An ESP32 that is not a C3, with the C3 selected → "La placa conectada no es la que elegiste…". Nothing is written. The header still says **Conectada** (or **Sin conexión** if the port did not come back). |
| Unplug mid-flash | Pull the USB cable while the bar is moving | "Se cortó la subida…" or "Se perdió la conexión…". The header shows **Reconectando…**; plug the cable back in within ~6 s and it returns to **Conectada** by itself. Left unplugged, it ends on **Conectar** (or **Sin conexión**). Upload again: it works. |
| RESET button (C3) | Press RESET on the SuperMini while connected | **Reconectando…**, then **Conectada** within a few seconds, no chooser; the monitor shows the boot output. (The NANO's CH340 does not re-enumerate: its header stays **Conectada**.) |
| Cancel (C3 only) | Press **Cancelar** while "Escribiendo tu programa…" is showing | "Cancelaste la subida…". The port comes back (**Conectada**). Uploading again works. The NANO has no Cancel button (avrgirl cannot stop midway). |

If the C3 never syncs ("…mantén apretado BOOT…"), do exactly what the message says: hold BOOT,
press and release RESET, release BOOT, press **Subir** again. Note in the PR whether this was
needed: a SuperMini on native USB should normally reset into the bootloader by itself.

## Also note in the PR

- Whether the serial monitor (B9) shows `hola` right after the upload: the monitor is muted
  during the flash and the port reopens at the monitor's baud (115200 unless changed).
- Chrome version and OS.
