// Ambient types for the two untyped modules the avrgirl path loads.

declare module 'process/browser.js' {
  const process: { env: Record<string, string | undefined>; browser: boolean };
  export default process;
}

// The prebuilt UMD bundle (package.json `module` field); `avrgirl-arduino-browser.js` is the
// CommonJS source and needs Node's fs/stream/util, so we never import that one.
declare module 'avrgirl-arduino/dist/avrgirl-arduino.min.js' {
  export interface AvrgirlOptions {
    board: string;
    debug?: boolean | ((...args: unknown[]) => void);
    megaDebug?: boolean;
  }
  export interface AvrgirlInstance {
    flash(file: Uint8Array, callback: (error?: unknown) => void): void;
  }
  const AvrgirlArduino: new (options: AvrgirlOptions) => AvrgirlInstance;
  export default AvrgirlArduino;
}
