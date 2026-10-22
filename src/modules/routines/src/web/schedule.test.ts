import { describe, expect, it } from 'vitest';
import { describeSchedule, fromCron, isComplete, toSchedule, toTrigger } from './schedule.ts';

describe('guided schedules', () => {
  it.each([
    ['30 7 * * *', { kind: 'daily', time: '07:30' }],
    ['0 8 * * 1-5', { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' }],
    ['0 9 * * 0,6', { kind: 'weekly', days: [0, 6], time: '09:00' }],
    ['0 9 * * 0-6', { kind: 'daily', time: '09:00' }],
    ['0 9 * * 7', { kind: 'weekly', days: [0], time: '09:00' }],
    ['15 20 1 * *', { kind: 'monthly', day: '1', time: '20:15' }],
    ['*/5 * * * *', { kind: 'cron', expression: '*/5 * * * *' }],
    ['0 8 1 * 1', { kind: 'cron', expression: '0 8 1 * 1' }],
    ['0 8 * 1 *', { kind: 'cron', expression: '0 8 * 1 *' }],
  ])('reads %s', (expression, schedule) => expect(fromCron(expression)).toEqual(schedule));

  it('writes guided schedules as cron and round-trips them', () => {
    for (const schedule of [
      { kind: 'daily', time: '07:30' },
      { kind: 'weekly', days: [5, 1, 3], time: '18:05' },
      { kind: 'monthly', day: '15', time: '00:00' },
    ] as const) {
      const trigger = toTrigger(schedule) as { type: 'cron'; expression: string };
      expect(trigger.type).toBe('cron');
      const back = toSchedule(trigger);
      expect(back).toEqual(
        schedule.kind === 'weekly' ? { ...schedule, days: [1, 3, 5] } : schedule,
      );
    }
    expect(toTrigger({ kind: 'weekly', days: [5, 1, 3], time: '18:05' })).toEqual({
      type: 'cron',
      expression: '5 18 * * 1,3,5',
    });
  });

  it('turns intervals into minutes and back into hours when they fit', () => {
    expect(toTrigger({ kind: 'every', amount: '3', unit: 'hours' })).toEqual({
      type: 'interval',
      everyMinutes: 180,
    });
    expect(toSchedule({ type: 'interval', everyMinutes: 180 })).toEqual({
      kind: 'every',
      amount: '3',
      unit: 'hours',
    });
    expect(toSchedule({ type: 'interval', everyMinutes: 90 })).toEqual({
      kind: 'every',
      amount: '90',
      unit: 'minutes',
    });
  });

  it('describes schedules', () => {
    const weekdays = { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' } as const;
    expect(describeSchedule(weekdays)).toBe('Monday to Friday at 08:00');
    expect(describeSchedule({ kind: 'weekly', days: [0, 6], time: '10:00' })).toBe(
      'At weekends at 10:00',
    );
    expect(describeSchedule({ kind: 'weekly', days: [3], time: '10:00' })).toBe(
      'Wednesday at 10:00',
    );
    expect(describeSchedule({ kind: 'monthly', day: '1', time: '09:00' })).toBe(
      'On day 1 of every month at 09:00',
    );
    expect(describeSchedule({ kind: 'every', amount: '1', unit: 'hours' })).toBe('Every hour');
    expect(describeSchedule({ kind: 'every', amount: '30', unit: 'minutes' })).toBe(
      'Every 30 minutes',
    );
  });

  it('knows when a form is not filled in', () => {
    expect(isComplete({ kind: 'weekly', days: [], time: '08:00' })).toBe(false);
    expect(isComplete({ kind: 'daily', time: '' })).toBe(false);
    expect(isComplete({ kind: 'monthly', day: '32', time: '08:00' })).toBe(false);
    expect(isComplete({ kind: 'every', amount: '0', unit: 'minutes' })).toBe(false);
    expect(isComplete({ kind: 'once', local: '' })).toBe(false);
    expect(isComplete({ kind: 'cron', expression: '0 8 *' })).toBe(false);
    expect(isComplete({ kind: 'weekly', days: [1], time: '08:00' })).toBe(true);
  });

  it("reads and writes a date in the Owner's zone, across a DST change", () => {
    const rome = { kind: 'once', local: '2026-10-25T08:00' } as const;
    // 25 October 2026: Rome is back on UTC+1 from 03:00.
    expect(toTrigger(rome, 'Europe/Rome')).toEqual({
      type: 'once',
      at: '2026-10-25T07:00:00.000Z',
    });
    expect(toTrigger({ kind: 'once', local: '2026-07-01T08:00' }, 'Europe/Rome')).toEqual({
      type: 'once',
      at: '2026-07-01T06:00:00.000Z',
    });
    expect(toTrigger(rome, 'America/New_York')).toEqual({
      type: 'once',
      at: '2026-10-25T12:00:00.000Z',
    });
    expect(toSchedule({ type: 'once', at: '2026-10-25T07:00:00Z' }, 'Europe/Rome')).toEqual(rome);
    expect(describeSchedule(rome)).toBe('Once, 25 Oct 2026, 08:00');
  });

  it('takes the first of a time that happens twice, and moves one that never happens on', () => {
    const at = (local: string, zone: string) =>
      (toTrigger({ kind: 'once', local }, zone) as { at: string }).at;

    // Twice: summer time first, in Rome and in New York alike.
    expect(at('2026-10-25T02:30', 'Europe/Rome')).toBe('2026-10-25T00:30:00.000Z');
    expect(at('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    // Never: the clock jumps from 2:00 to 3:00, so 2:30 is 3:30.
    expect(at('2026-03-29T02:30', 'Europe/Rome')).toBe('2026-03-29T01:30:00.000Z');
    expect(at('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
  });
});
