// Improv Wi-Fi provisioning (improv-wifi.com, Apache-2.0) behind one small interface, so the
// dialog does not care whether it talks to the board over the USB cable (Web Serial) or over
// Bluetooth LE (Web Bluetooth, Android Chrome). Both SDKs are loaded with a dynamic import,
// so neither lands in the main bundle.
//
// SDKs (npm, pinned): `improv-wifi-serial-sdk` (github improv-wifi/sdk-serial-js) →
// `dist/serial.js` `ImprovSerial(port, logger)`: `initialize()` (detects Improv, reads
// `info.name`), `scan()`, `provision(ssid, password, timeout)` → `nextUrl`, events
// `state-changed`/`error-changed`, `close()` (port must already be open at 115200 and is
// left open). `improv-wifi-sdk` (github improv-wifi/sdk-ble-js) → `dist/ble.js`
// `ImprovBluetoothLE(device, logger)`: `initialize()`, `currentState` (1 = authorization
// required, e.g. press the board's button), `provision()` → URL or undefined with
// `errorState` set, event `state-changed`, `close()`. Only the protocol classes are imported;
// the SDKs' own Lit dialogs are not used.
//
// The provisioned URL carries the pairing token: the SDK loggers below drop every argument
// (the serial SDK hex-dumps RPC results at debug level), so it never reaches the console.

/** The Improv BLE service UUID (improv-wifi sdk-ble-js src/const.ts). */
export const IMPROV_BLE_SERVICE = '00467768-6228-2272-4663-277478268000';
/** How long a provisioning attempt may take before we give up (the board tries to join). */
export const PROVISION_TIMEOUT_MS = 30_000;
/** How long the student has to press the board's button when BLE asks for authorization. */
export const AUTHORIZE_TIMEOUT_MS = 60_000;

export type ProvisionPhase = 'authorizing' | 'provisioning' | 'provisioned';

export type ImprovErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'not-improv'
  | 'wrong-password'
  | 'not-authorized'
  | 'timeout'
  | 'no-url'
  | 'failed';

export class ImprovError extends Error {
  readonly code: ImprovErrorCode;
  constructor(code: ImprovErrorCode, detail: string = code) {
    super(detail);
    this.name = 'ImprovError';
    this.code = code;
  }
}

export interface ImprovSession {
  readonly kind: 'serial' | 'ble';
  /** The board's name as it reports it (serial `info.name`, BLE device name). */
  readonly name?: string;
  /** Networks the board can see, when it can scan (serial); empty otherwise. */
  scan(): Promise<string[]>;
  /** Sends the credentials; resolves with the provisioned URL. */
  provision(
    ssid: string,
    password: string,
    onPhase: (phase: ProvisionPhase) => void,
  ): Promise<string>;
  /** Releases the SDK (the serial port itself stays open: its owner closes it). */
  close(): Promise<void>;
}

const quietLogger = {
  log: () => {},
  debug: () => {},
  // Message only: the arguments may carry packet data (with the token).
  error: (message: string) => console.warn(`[improv] ${message}`),
};

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new ImprovError('timeout'));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---- serial -----------------------------------------------------------------------------

/** The part of a Web Serial port the serial SDK needs (open, at 115200). */
export interface OpenSerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

/** Improv serial state codes (sdk-serial-js src/const.ts ImprovSerialCurrentState). */
const SERIAL_PROVISIONING = 0x03;
/** Error strings the serial SDK rejects with (ERROR_MSGS). */
const SERIAL_ERRORS: Record<string, ImprovErrorCode> = {
  UNABLE_TO_CONNECT: 'wrong-password',
  TIMEOUT: 'timeout',
};

/**
 * Starts Improv over the cable on a port that is already open at 115200. Fails with
 * 'not-improv' when the board does not answer (no resident firmware on it yet).
 */
export async function openSerialImprov(port: OpenSerialPort): Promise<ImprovSession> {
  const { ImprovSerial } = await import('improv-wifi-serial-sdk/dist/serial.js');
  const improv = new ImprovSerial(port as never, quietLogger);
  try {
    await improv.initialize(3_000);
  } catch (error) {
    throw new ImprovError('not-improv', describe(error));
  }
  return {
    kind: 'serial',
    name: improv.info?.name,
    async scan() {
      try {
        const ssids = await improv.scan(15_000);
        return [...new Set(ssids.map((ssid) => ssid.name).filter(Boolean))];
      } catch {
        return [];
      }
    },
    async provision(ssid, password, onPhase) {
      const onState = (event: Event) => {
        if ((event as CustomEvent<number>).detail === SERIAL_PROVISIONING) onPhase('provisioning');
      };
      improv.addEventListener('state-changed', onState);
      onPhase('provisioning');
      try {
        await improv.provision(ssid, password, PROVISION_TIMEOUT_MS);
      } catch (error) {
        const text = describe(error);
        throw new ImprovError(SERIAL_ERRORS[text] ?? 'failed', text);
      } finally {
        improv.removeEventListener('state-changed', onState);
      }
      if (!improv.nextUrl) throw new ImprovError('no-url');
      onPhase('provisioned');
      return improv.nextUrl;
    },
    async close() {
      await improv.close();
    },
  };
}

// ---- Bluetooth LE -------------------------------------------------------------------------

interface BluetoothLike {
  requestDevice(options: {
    filters: { services: string[] }[];
    optionalServices?: string[];
  }): Promise<{ name?: string }>;
}

export function getBluetooth(): BluetoothLike | undefined {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) return undefined;
  return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth ?? undefined;
}

export function isBluetoothSupported(): boolean {
  return getBluetooth() !== undefined;
}

/** BLE current state / error codes (sdk-ble-js src/const.ts). */
const BLE_AUTHORIZATION_REQUIRED = 0x01;
const BLE_PROVISIONING = 0x03;
const BLE_ERRORS: Record<number, ImprovErrorCode> = {
  0x03: 'wrong-password',
  0x04: 'not-authorized',
};

/**
 * Opens the browser's Bluetooth chooser for Improv boards. Like `requestPort`, it must be
 * called synchronously inside the click (user activation), so it is not `async` and loads
 * the SDK only after the chooser returned.
 */
export function requestBleImprov(bluetooth = getBluetooth()): Promise<ImprovSession> {
  if (!bluetooth) return Promise.reject(new ImprovError('unsupported'));
  let chosen: Promise<{ name?: string }>;
  try {
    chosen = bluetooth.requestDevice({ filters: [{ services: [IMPROV_BLE_SERVICE] }] });
  } catch (error) {
    return Promise.reject(new ImprovError('failed', describe(error)));
  }
  return chosen.then(
    async (device) => {
      const { ImprovBluetoothLE } = await import('improv-wifi-sdk/dist/ble.js');
      const improv = new ImprovBluetoothLE(device as never, quietLogger);
      try {
        await improv.initialize();
      } catch (error) {
        improv.close();
        throw new ImprovError('not-improv', describe(error));
      }
      return bleSession(improv, device.name);
    },
    (error: unknown) => {
      // Chrome rejects with NotFoundError when the chooser is closed without a pick.
      const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
      throw new ImprovError(name === 'NotFoundError' ? 'cancelled' : 'failed', describe(error));
    },
  );
}

interface BleImprov extends EventTarget {
  currentState?: number;
  errorState: number;
  provision(ssid: string, password: string): Promise<string | undefined>;
  close(): void;
}

function bleSession(improv: BleImprov, name: string | undefined): ImprovSession {
  const waitForAuthorization = () =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (improv.currentState !== BLE_AUTHORIZATION_REQUIRED) {
          improv.removeEventListener('state-changed', check);
          resolve();
        }
      };
      improv.addEventListener('state-changed', check);
      check();
    });

  return {
    kind: 'ble',
    name,
    // The published BLE SDK (1.4.1) has no network scan: the student types the SSID.
    scan: async () => [],
    async provision(ssid, password, onPhase) {
      if (improv.currentState === BLE_AUTHORIZATION_REQUIRED) {
        onPhase('authorizing');
        await withTimeout(waitForAuthorization(), AUTHORIZE_TIMEOUT_MS, () => improv.close());
      }
      const onState = () => {
        if (improv.currentState === BLE_PROVISIONING) onPhase('provisioning');
      };
      improv.addEventListener('state-changed', onState);
      onPhase('provisioning');
      try {
        // The SDK resolves undefined on any device error and sets `errorState`.
        const url = await withTimeout(improv.provision(ssid, password), PROVISION_TIMEOUT_MS, () =>
          improv.close(),
        );
        if (!url) {
          const code = BLE_ERRORS[improv.errorState];
          throw new ImprovError(code ?? 'failed', `error state ${improv.errorState}`);
        }
        onPhase('provisioned');
        return url;
      } finally {
        improv.removeEventListener('state-changed', onState);
      }
    },
    async close() {
      improv.close();
    },
  };
}
