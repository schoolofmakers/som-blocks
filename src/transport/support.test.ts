import { describe, expect, it } from 'vitest';
import { detectSupport } from './support';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  opera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0',
  headlessChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIpad:
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

describe('detectSupport', () => {
  it.each([
    ['desktop Chrome (macOS)', UA.chromeMac, true, 'yes', []],
    ['desktop Chrome (Windows)', UA.chromeWindows, true, 'yes', []],
    ['desktop Edge', UA.edge, true, 'yes', []],
    ['desktop Opera', UA.opera, true, 'yes', []],
    ['headless Chromium (Playwright)', UA.headlessChrome, true, 'yes', []],
    ['Android Chrome', UA.chromeAndroid, false, 'no', ['UI_SUPPORT_REASON_ANDROID']],
    // Even if a future Android Chrome exposes navigator.serial (Bluetooth only), no USB.
    ['Android Chrome with serial', UA.chromeAndroid, true, 'no', ['UI_SUPPORT_REASON_ANDROID']],
    ['iPhone Safari', UA.safariIphone, false, 'no', ['UI_SUPPORT_REASON_IOS']],
    ['iPad Chrome', UA.chromeIpad, false, 'no', ['UI_SUPPORT_REASON_IOS']],
    ['desktop Firefox', UA.firefoxMac, false, 'no', ['UI_SUPPORT_REASON_FIREFOX']],
    ['desktop Safari', UA.safariMac, false, 'no', ['UI_SUPPORT_REASON_SAFARI']],
    [
      'Chrome without serial (http, policy)',
      UA.chromeMac,
      false,
      'no',
      ['UI_SUPPORT_REASON_NO_SERIAL'],
    ],
    ['unknown browser', 'SomethingElse/1.0', false, 'no', ['UI_SUPPORT_REASON_NO_SERIAL']],
  ] as const)('%s', (_name, userAgent, hasSerial, usb, reasons) => {
    expect(detectSupport(userAgent, hasSerial)).toEqual({ usb, wifi: 'coming', reasons });
  });
});
