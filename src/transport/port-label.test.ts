import { describe, expect, it } from 'vitest';
import { boardForPort, portLabel } from './port-label';

describe('port labels', () => {
  it('names a CH340 after the selected board when its filters match', () => {
    const ch340 = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
    expect(portLabel(ch340, 'nano-old')).toBe('Arduino NANO · 1a86:7523');
    expect(portLabel(ch340, 'uno')).toBe('Arduino UNO · 1a86:7523');
  });

  it('falls back to any matching board when the selected one does not match', () => {
    const espressif = { usbVendorId: 0x303a, usbProductId: 0x1001 };
    expect(boardForPort(espressif, 'uno')?.id).toBe('esp32c3-supermini');
    expect(portLabel(espressif, 'uno')).toBe('ESP32-C3 SuperMini · 303a:1001');
  });

  it('names known bridges and unknown ids for ports outside the registry', () => {
    expect(portLabel({ usbVendorId: 0x10c4, usbProductId: 0xea60 })).toBe('CP210x · 10c4:ea60');
    expect(portLabel({ usbVendorId: 0x1234, usbProductId: 0x0001 })).toBe('USB · 1234:0001');
    expect(portLabel({ usbVendorId: 0x1234 })).toBe('USB · 1234');
  });

  it('returns null for a port without USB ids', () => {
    expect(portLabel({})).toBeNull();
    expect(boardForPort({})).toBeUndefined();
  });
});
