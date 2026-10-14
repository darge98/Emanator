export interface Logger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

/** Plain console logger with a scope prefix, e.g. `[telegram]`. */
export function consoleLogger(scope: string): Logger {
  const line = (message: string, details?: Record<string, unknown>) =>
    details ? `[${scope}] ${message} ${JSON.stringify(details)}` : `[${scope}] ${message}`;
  return {
    info: (message, details) => console.log(line(message, details)),
    warn: (message, details) => console.warn(line(message, details)),
    error: (message, details) => console.error(line(message, details)),
  };
}

/** Swallows everything; for tests. */
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
