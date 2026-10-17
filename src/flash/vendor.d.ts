// Ambient type for the untyped `process` browser shim the avrgirl path installs as a global.
// (avrgirl itself is loaded as a classic script by URL; its type lives in avrgirl.ts.)

declare module 'process/browser.js' {
  const process: { env: Record<string, string | undefined>; browser: boolean };
  export default process;
}
