import { describe, expect, it } from 'vitest';
import { RoutineValidationError } from './errors.ts';
import { nextFire, validateTrigger } from './trigger.ts';

const zone = { anchor: new Date('2026-10-18T08:00:00Z'), timeZone: 'Europe/Rome' };

describe('validateTrigger', () => {
  it.each([
    [{ type: 'once', at: '2026-10-19T08:00:00+02:00' }],
    [{ type: 'once', at: '2026-10-19T06:00Z' }],
    [{ type: 'interval', everyMinutes: 30 }],
    [{ type: 'cron', expression: '0 8 * * 1-5' }],
  ])('accepts %j', (trigger) => expect(validateTrigger(trigger)).toEqual(trigger));

  it.each([
    [{ type: 'once', at: '2026-10-19T08:00:00' }],
    [{ type: 'once', at: 'domani' }],
    [{ type: 'interval', everyMinutes: 0 }],
    [{ type: 'interval', everyMinutes: 1.5 }],
    [{ type: 'cron', expression: '*/5 * * * * *' }],
    [{ type: 'cron', expression: '99 8 * * *' }],
    [{ type: 'webhook' }],
    [null],
  ])('rejects %j', (trigger) =>
    expect(() => validateTrigger(trigger)).toThrow(RoutineValidationError),
  );
});

describe('nextFire', () => {
  it('fires a date once, only while it is in the future', () => {
    const trigger = { type: 'once', at: '2026-10-19T08:00:00+02:00' } as const;
    expect(nextFire(trigger, new Date('2026-10-18T10:00:00Z'), zone)).toEqual(
      new Date('2026-10-19T06:00:00Z'),
    );
    expect(nextFire(trigger, new Date('2026-10-19T06:00:00Z'), zone)).toBeUndefined();
  });

  it('counts intervals from the anchor', () => {
    const trigger = { type: 'interval', everyMinutes: 60 } as const;
    expect(nextFire(trigger, new Date('2026-10-18T10:30:00Z'), zone)).toEqual(
      new Date('2026-10-18T11:00:00Z'),
    );
    expect(nextFire(trigger, new Date('2026-10-18T11:00:00Z'), zone)).toEqual(
      new Date('2026-10-18T12:00:00Z'),
    );
    expect(nextFire(trigger, new Date('2026-10-18T07:00:00Z'), zone)).toEqual(
      new Date('2026-10-18T09:00:00Z'),
    );
  });

  it('reads cron expressions in the Harness time zone, across DST', () => {
    const trigger = { type: 'cron', expression: '0 8 * * *' } as const;
    // Rome is UTC+2 until 25 October 2026, then UTC+1.
    expect(nextFire(trigger, new Date('2026-10-18T10:00:00Z'), zone)).toEqual(
      new Date('2026-10-19T06:00:00Z'),
    );
    expect(nextFire(trigger, new Date('2026-10-25T10:00:00Z'), zone)).toEqual(
      new Date('2026-10-26T07:00:00Z'),
    );
  });
});
