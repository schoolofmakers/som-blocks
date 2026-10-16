import { BOARDS, getBoard } from '../boards/registry';
import type { BoardDefinition, UsbFilter } from '../boards/types';
import type { SerialPortInfoLike } from './web-serial';

// USB bridge chips we know by name, for ports that match no board in the registry
// (e.g. a NANO clone picked through "show all ports"). Product names, not translated.
const KNOWN_BRIDGES: readonly (UsbFilter & { name: string })[] = [
  { usbVendorId: 0x1a86, usbProductId: 0x7523, name: 'CH340' },
  { usbVendorId: 0x1a86, name: 'WCH USB' },
  { usbVendorId: 0x0403, name: 'FTDI' },
  { usbVendorId: 0x10c4, name: 'CP210x' },
  { usbVendorId: 0x303a, name: 'Espressif USB' },
  { usbVendorId: 0x2341, name: 'Arduino' },
  { usbVendorId: 0x2a03, name: 'Arduino' },
];

function matches(filter: UsbFilter, info: SerialPortInfoLike): boolean {
  return (
    filter.usbVendorId === info.usbVendorId &&
    (filter.usbProductId === undefined || filter.usbProductId === info.usbProductId)
  );
}

const hex = (id: number): string => id.toString(16).padStart(4, '0');

/** The registry board this port looks like: the selected board first, then any other. */
export function boardForPort(
  info: SerialPortInfoLike,
  preferredBoardId?: string,
): BoardDefinition | undefined {
  if (info.usbVendorId === undefined) return undefined;
  const preferred = preferredBoardId ? getBoard(preferredBoardId) : undefined;
  if (preferred?.usbFilters.some((filter) => matches(filter, info))) return preferred;
  return BOARDS.find((board) => board.usbFilters.some((filter) => matches(filter, info)));
}

/**
 * A short, language-neutral label for a port: "Arduino NANO · 1a86:7523". Null when the
 * port reports no USB ids (the UI then shows a generic "serial port").
 */
export function portLabel(info: SerialPortInfoLike, preferredBoardId?: string): string | null {
  if (info.usbVendorId === undefined) return null;
  const ids =
    info.usbProductId === undefined
      ? hex(info.usbVendorId)
      : `${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
  const name =
    boardForPort(info, preferredBoardId)?.name ??
    KNOWN_BRIDGES.find((bridge) => matches(bridge, info))?.name ??
    'USB';
  return `${name} · ${ids}`;
}
