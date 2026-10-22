import { describe, expect, it } from 'vitest';
import { canonicalTimeZone } from './time-zone.ts';

describe('canonicalTimeZone', () => {
  it("names a zone the runtime's way, and refuses fixed offsets and unknown names", () => {
    expect(canonicalTimeZone(' europe/rome ')).toBe('Europe/Rome');
    expect(canonicalTimeZone('Etc/UTC')).toBe('UTC');
    expect(canonicalTimeZone('+02:00')).toBeUndefined();
    expect(canonicalTimeZone('-05:00')).toBeUndefined();
    expect(canonicalTimeZone('Mars/Olympus')).toBeUndefined();
    expect(canonicalTimeZone(42)).toBeUndefined();
  });
});
