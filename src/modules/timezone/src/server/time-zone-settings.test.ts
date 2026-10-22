import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TimeZoneError, TimeZoneSettings } from './time-zone-settings.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('TimeZoneSettings', () => {
  it('starts from the initial zone, keeps what the Owner saves and announces changes', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const first = new TimeZoneSettings(fixture.db, 'Europe/Rome', silentLogger);
    await first.init();
    const heard: string[] = [];
    first.onTimeZoneChange((zone) => heard.push(zone));

    await first.setTimeZone('Europe/Rome');
    await first.setTimeZone('America/New_York');
    await expect(first.setTimeZone('Mars/Olympus')).rejects.toThrow(TimeZoneError);
    await expect(first.setTimeZone('+02:00')).rejects.toThrow(TimeZoneError);
    expect(await first.setTimeZone('america/new_york')).toBe('America/New_York');

    expect(heard).toEqual(['America/New_York']);
    const restarted = new TimeZoneSettings(fixture.db, 'UTC', silentLogger);
    await restarted.init();
    expect(restarted.timeZone()).toBe('America/New_York');
  });
});
