import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Routine } from '../domain/routine.ts';
import { RoutineScheduler } from './routine-scheduler.ts';

const start = new Date('2026-10-18T10:00:00Z');

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'r1',
    name: 'Heartbeat',
    prompt: 'Controlla.',
    enabled: true,
    triggers: [{ type: 'interval', everyMinutes: 10 }],
    kind: 'routine',
    createdBy: 'owner',
    createdAt: start,
    updatedAt: start,
    ...overrides,
  };
}

describe('RoutineScheduler', () => {
  let fired: string[];
  let scheduler: RoutineScheduler;

  beforeEach(() => {
    vi.useFakeTimers({ now: start });
    fired = [];
    scheduler = new RoutineScheduler({
      timeZone: () => 'Europe/Rome',
      onFire: (id) => fired.push(id),
    });
  });
  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('fires every interval', async () => {
    scheduler.schedule(routine());
    await vi.advanceTimersByTimeAsync(35 * 60_000);
    expect(fired).toEqual(['r1', 'r1', 'r1']);
  });

  it('fires a date once', async () => {
    scheduler.schedule(routine({ triggers: [{ type: 'once', at: '2026-10-18T10:05:00Z' }] }));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fired).toEqual(['r1']);
  });

  it('replaces the timers when rescheduled, and stops on unschedule', async () => {
    scheduler.schedule(routine());
    scheduler.schedule(routine({ triggers: [{ type: 'interval', everyMinutes: 30 }] }));
    await vi.advanceTimersByTimeAsync(35 * 60_000);
    expect(fired).toEqual(['r1']);

    scheduler.unschedule('r1');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fired).toEqual(['r1']);
  });

  it('does not schedule a disabled Routine', async () => {
    scheduler.schedule(routine({ enabled: false }));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fired).toEqual([]);
    expect(scheduler.nextRun(routine({ enabled: false }))).toBeUndefined();
  });

  it('skips Events in the past and reports the earliest next Run', () => {
    const r = routine({
      triggers: [
        { type: 'once', at: '2026-10-18T09:00:00Z' },
        { type: 'cron', expression: '30 12 * * *' },
        { type: 'interval', everyMinutes: 180 },
      ],
    });
    expect(scheduler.nextRun(r)).toEqual(new Date('2026-10-18T10:30:00Z'));
  });

  it('waits beyond the setTimeout ceiling', async () => {
    scheduler.schedule(routine({ triggers: [{ type: 'once', at: '2026-12-01T10:00:00Z' }] }));
    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60_000);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(15 * 24 * 60 * 60_000);
    expect(fired).toEqual(['r1']);
  });

  it('reads cron in the zone in force, so rescheduling follows a new zone', () => {
    let zone = 'Europe/Rome';
    const zoned = new RoutineScheduler({ timeZone: () => zone, onFire: () => {} });
    const daily = routine({ triggers: [{ type: 'cron', expression: '0 8 * * *' }] });

    expect(zoned.nextRun(daily)?.toISOString()).toBe('2026-10-19T06:00:00.000Z');
    zone = 'America/New_York';
    expect(zoned.nextRun(daily)?.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    zoned.stop();
  });

  it('arms again only what is armed now', async () => {
    const daily = (id: string) =>
      routine({ id, triggers: [{ type: 'cron', expression: '30 12 * * *' }] });
    scheduler.schedule(daily('kept'));
    scheduler.schedule(daily('gone'));
    scheduler.schedule({ ...daily('paused'), enabled: false });
    scheduler.unschedule('gone');

    scheduler.rescheduleAll();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);

    expect(fired).toEqual(['kept']);
  });
});
