/**
 * The Owner's time zone, an IANA name such as `Europe/Rome`. Instants are stored as they are,
 * in UTC; the zone only says how to read wall-clock times: "alle 18", "ogni giorno alle 8".
 */
export const DEFAULT_TIME_ZONE = 'Europe/Rome';

/**
 * The runtime's own name for a zone (`europe/rome` → `Europe/Rome`, `EST` → `America/Panama`),
 * or undefined for anything else. A fixed offset like `+02:00` is refused: it knows no DST, so
 * "every day at 8" would drift by an hour twice a year.
 */
export function canonicalTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || /^[+-]/.test(value.trim())) return undefined;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export const isTimeZone = (value: unknown): value is string =>
  canonicalTimeZone(value) !== undefined;

/** Every zone the runtime knows, for the Owner to pick from. */
export function timeZones(): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes('UTC') ? zones : [...zones, 'UTC'];
}
