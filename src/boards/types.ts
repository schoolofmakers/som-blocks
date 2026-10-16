import type { PinProfile } from '../blocks/pins';
import type { MessageKey } from '../i18n/messages';

// Boards are data (_config/standards.md): adding a board is a new file under
// definitions/ plus one line in registry.ts, never a code change elsewhere.

export type Chip = 'avr' | 'esp32' | 'esp32c3' | 'esp8266';

export interface UsbFilter {
  usbVendorId: number;
  usbProductId?: number;
}

export interface UploadProfile {
  tool: 'avrgirl' | 'esptool';
  /** avrgirl-arduino board profile name (stk500v1 protocol and baud come with it). */
  avrgirlBoard?: 'uno' | 'nano';
  baud?: number;
  /**
   * Flash address of the bootloader image, esp family only. Taken from here, never from
   * the compile server, which returns 0x1000 even for chips whose address is 0x0
   * (_config/boards.md, "Bootloader address rule"): esp32 = 0x1000, esp32c3 = 0x0.
   */
  bootloaderAddress?: number;
}

export interface BoardDefinition {
  id: string;
  /** Product name, shown as-is in every language (product names are not translated). */
  name: string;
  /** Translated qualifier shown after the name, e.g. "(bootloader viejo)". */
  variantKey?: MessageKey;
  /** Base FQBN, `vendor:arch:board`, without options. */
  fqbn: string;
  /** Fixed board options appended to the FQBN by `fullFqbn` (e.g. C3 `CDCOnBoot: 'cdc'`). */
  options: Readonly<Record<string, string>>;
  chip: Chip;
  upload: UploadProfile;
  /** Web Serial `requestPort({ filters })` entries. */
  usbFilters: readonly UsbFilter[];
  pins: PinProfile;
  notes?: string;
}

/**
 * The FQBN arduino-cli compiles with: `vendor:arch:board[:opt=val[,opt=val]...]`.
 * Options go in a single fourth colon-separated segment, comma-separated; arduino-cli
 * rejects an FQBN with more than four colon parts (pkg/fqbn/fqbn.go).
 */
export function fullFqbn(board: Pick<BoardDefinition, 'fqbn' | 'options'>): string {
  const options = Object.entries(board.options).map(([key, value]) => `${key}=${value}`);
  return options.length === 0 ? board.fqbn : `${board.fqbn}:${options.join(',')}`;
}
