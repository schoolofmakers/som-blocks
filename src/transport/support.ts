import type { MessageKey } from '../i18n/messages';

// Browser support matrix for the connect screen (_config/architecture.md → Transports):
// USB needs Web Serial, which only desktop Chromium browsers ship. Mobile browsers never get
// USB here, even if a future Android Chrome exposes `navigator.serial` (Bluetooth serial
// only), because the cable path is desktop-only by design; they get the WiFi path (Track D).

export interface SupportMatrix {
  usb: 'yes' | 'no';
  /** WiFi through the relay (Track D) works from any browser once it ships. */
  wifi: 'coming';
  /** Why USB is unavailable, as i18n keys; empty when `usb === 'yes'`. */
  reasons: MessageKey[];
}

const IOS = /iPhone|iPad|iPod/;
const ANDROID = /Android/;
const FIREFOX = /Firefox\//;
// Safari's UA also says "Safari/", but so does every Chromium browser: exclude those.
const SAFARI = /Safari\//;
const CHROMIUM = /Chrome\/|Chromium\/|Edg\/|OPR\//;

const unsupported = (reason: MessageKey): SupportMatrix => ({
  usb: 'no',
  wifi: 'coming',
  reasons: [reason],
});

export function detectSupport(userAgent: string, hasSerial: boolean): SupportMatrix {
  // Every iOS browser is WebKit underneath (CriOS, FxiOS, EdgiOS): none has Web Serial.
  if (IOS.test(userAgent)) return unsupported('UI_SUPPORT_REASON_IOS');
  if (ANDROID.test(userAgent)) return unsupported('UI_SUPPORT_REASON_ANDROID');
  if (hasSerial) return { usb: 'yes', wifi: 'coming', reasons: [] };
  if (FIREFOX.test(userAgent)) return unsupported('UI_SUPPORT_REASON_FIREFOX');
  if (SAFARI.test(userAgent) && !CHROMIUM.test(userAgent)) {
    return unsupported('UI_SUPPORT_REASON_SAFARI');
  }
  // A Chromium without `navigator.serial`: an old version, Web Serial disabled by policy,
  // or the page opened over plain http (Web Serial needs a secure context).
  return unsupported('UI_SUPPORT_REASON_NO_SERIAL');
}
