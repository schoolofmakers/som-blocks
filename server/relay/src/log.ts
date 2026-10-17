export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/**
 * One JSON object per line on stdout (Fly ships stdout to its log stream).
 * Callers never pass tokens, `Authorization` headers or request bodies here.
 */
export function jsonLogger(write: (line: string) => void = (l) => process.stdout.write(l)): Logger {
  const emit = (level: string, msg: string, fields?: LogFields) =>
    write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }) + '\n');
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
