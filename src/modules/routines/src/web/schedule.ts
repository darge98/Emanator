import type { Trigger } from '../domain/trigger.ts';

/**
 * How the editor shows a Trigger. Daily, weekly and monthly schedules are cron
 * expressions underneath; anything the guided forms can't express stays raw cron.
 */
export type ScheduleDraft =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'monthly'; day: string; time: string }
  | { kind: 'once'; local: string }
  | { kind: 'every'; amount: string; unit: 'minutes' | 'hours' }
  | { kind: 'cron'; expression: string };

export type ScheduleKind = ScheduleDraft['kind'];

/** Cron weekday numbers in the order a European week is shown: Monday first. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

const WORKDAYS = [1, 2, 3, 4, 5];

export function blankSchedule(
  kind: ScheduleKind,
  timeZone?: string,
  now = new Date(),
): ScheduleDraft {
  switch (kind) {
    case 'daily':
      return { kind, time: '08:00' };
    case 'weekly':
      return { kind, days: [...WORKDAYS], time: '08:00' };
    case 'monthly':
      return { kind, day: '1', time: '08:00' };
    case 'once':
      return { kind, local: toLocalInput(new Date(now.getTime() + 3_600_000), timeZone) };
    case 'every':
      return { kind, amount: '1', unit: 'hours' };
    case 'cron':
      return { kind, expression: '0 8 * * *' };
  }
}

/** A date reads in the Owner's time zone; the browser's when none is given. */
export function toSchedule(trigger: Trigger, timeZone?: string): ScheduleDraft {
  switch (trigger.type) {
    case 'once':
      return { kind: 'once', local: toLocalInput(new Date(trigger.at), timeZone) };
    case 'interval':
      return trigger.everyMinutes % 60 === 0
        ? { kind: 'every', amount: String(trigger.everyMinutes / 60), unit: 'hours' }
        : { kind: 'every', amount: String(trigger.everyMinutes), unit: 'minutes' };
    case 'cron':
      return fromCron(trigger.expression);
  }
}

/** What the API receives; the server does the real validation. */
export function toTrigger(schedule: ScheduleDraft, timeZone?: string): unknown {
  switch (schedule.kind) {
    case 'once': {
      const at = fromLocalInput(schedule.local, timeZone);
      return { type: 'once', at: at ? at.toISOString() : '' };
    }
    case 'every':
      return {
        type: 'interval',
        everyMinutes: Number(schedule.amount) * (schedule.unit === 'hours' ? 60 : 1),
      };
    case 'cron':
      return { type: 'cron', expression: schedule.expression.trim() };
    default:
      return { type: 'cron', expression: toCron(schedule) };
  }
}

/** Whether the form is filled in enough to save; details are checked by the server. */
export function isComplete(schedule: ScheduleDraft): boolean {
  switch (schedule.kind) {
    case 'daily':
      return Boolean(parseTime(schedule.time));
    case 'weekly':
      return schedule.days.length > 0 && Boolean(parseTime(schedule.time));
    case 'monthly': {
      const day = Number(schedule.day);
      return Number.isInteger(day) && day >= 1 && day <= 31 && Boolean(parseTime(schedule.time));
    }
    case 'once':
      return !Number.isNaN(new Date(schedule.local).getTime());
    case 'every': {
      const amount = Number(schedule.amount);
      return Number.isInteger(amount) && amount >= 1;
    }
    case 'cron':
      return schedule.expression.trim().split(/\s+/).length === 5;
  }
}

function toCron(schedule: Extract<ScheduleDraft, { kind: 'daily' | 'weekly' | 'monthly' }>) {
  const [hour, minute] = parseTime(schedule.time) ?? [0, 0];
  switch (schedule.kind) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${[...schedule.days].sort((a, b) => a - b).join(',')}`;
    case 'monthly':
      return `${minute} ${hour} ${Number(schedule.day)} * *`;
  }
}

/** Recognizes the expressions the guided forms produce, and a few common equivalents. */
export function fromCron(expression: string): ScheduleDraft {
  const raw: ScheduleDraft = { kind: 'cron', expression };
  const match = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|[0-7](?:[-,][0-7])*)$/.exec(
    expression.trim().replace(/\s+/g, ' '),
  );
  if (!match) return raw;
  const [, minute, hour, dayOfMonth, dayOfWeek] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (Number(minute) > 59 || Number(hour) > 23) return raw;
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (dayOfMonth === '*' && dayOfWeek === '*') return { kind: 'daily', time };
  if (dayOfMonth === '*') {
    const days = expandDays(dayOfWeek);
    if (!days) return raw;
    return days.length === 7 ? { kind: 'daily', time } : { kind: 'weekly', days, time };
  }
  if (dayOfWeek === '*' && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31) {
    return { kind: 'monthly', day: String(Number(dayOfMonth)), time };
  }
  return raw;
}

/** `1-5` or `1,3,5` into weekday numbers 0–6 (7 is Sunday too); undefined if unclear. */
function expandDays(field: string): number[] | undefined {
  const days = new Set<number>();
  for (const part of field.split(',')) {
    const [from, to = from] = part.split('-').map(Number) as [number, number?];
    if (from > to) return undefined;
    for (let day = from; day <= to; day++) days.add(day % 7);
  }
  return [...days].sort((a, b) => a - b);
}

function parseTime(value: string): [number, number] | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : undefined;
}

/** `YYYY-MM-DDTHH:mm` in `timeZone` (the browser's if none), as `datetime-local` wants. */
export function toLocalInput(date: Date, timeZone?: string): string {
  return wallClock(date, timeZone).slice(0, 16);
}

/**
 * The moment a `datetime-local` value means in `timeZone`; undefined when incomplete. Around a
 * DST change a time may happen twice, and then it is the first; or never, and then it is the
 * same time on the clock as it was before the change, which lands just after it.
 */
export function fromLocalInput(local: string, timeZone?: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as number[];
  const asUtc = Date.UTC(year as number, (month as number) - 1, day, hour, minute);
  // A day before and a day after, the zone's offsets are the two it switches between.
  const before = asUtc - offset(new Date(asUtc - 86_400_000), timeZone);
  const after = asUtc - offset(new Date(asUtc + 86_400_000), timeZone);
  const real = [before, after]
    .filter((at) => toLocalInput(new Date(at), timeZone) === local)
    .sort((a, b) => a - b);
  return new Date(real[0] ?? before);
}

/** `YYYY-MM-DDTHH:mm:ss` as a clock in `timeZone` shows `date`. */
function wallClock(date: Date, timeZone?: string): string {
  return date.toLocaleString('sv-SE', { timeZone }).replace(' ', 'T');
}

/** How far `timeZone`'s clock is ahead of UTC at `date`, in milliseconds. */
function offset(date: Date, timeZone?: string): number {
  const wall = new Date(`${wallClock(date, timeZone)}Z`).getTime();
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

export function dayName(day: number, width: 'short' | 'long'): string {
  // 4 January 2026 was a Sunday, so day `n` of that week has cron number `n`.
  return new Date(2026, 0, 4 + day).toLocaleDateString('en-GB', { weekday: width });
}

/** One sentence for the editor preview and the list, e.g. "Monday to Friday at 08:00". */
export function describeSchedule(schedule: ScheduleDraft): string {
  const at = (time: string) => `at ${time}`;
  switch (schedule.kind) {
    case 'daily':
      return `Every day ${at(schedule.time)}`;
    case 'weekly': {
      const days = schedule.days;
      const same = (set: number[]) =>
        set.length === days.length && set.every((day) => days.includes(day));
      if (same(WORKDAYS)) return `Monday to Friday ${at(schedule.time)}`;
      if (same([0, 6])) return `At weekends ${at(schedule.time)}`;
      const names = WEEK.filter((day) => days.includes(day)).map((day) =>
        dayName(day, days.length === 1 ? 'long' : 'short'),
      );
      return `${names.join(', ')} ${at(schedule.time)}`;
    }
    case 'monthly':
      return `On day ${schedule.day} of every month ${at(schedule.time)}`;
    case 'once': {
      // The wall-clock time as written, whatever the browser's zone.
      const date = new Date(`${schedule.local}Z`);
      if (Number.isNaN(date.getTime())) return 'Once';
      const when = date.toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      });
      return `Once, ${when}`;
    }
    case 'every': {
      const amount = Number(schedule.amount);
      const unit = schedule.unit === 'hours' ? 'hour' : 'minute';
      return amount === 1 ? `Every ${unit}` : `Every ${amount} ${unit}s`;
    }
    case 'cron':
      return `cron ${schedule.expression}`;
  }
}
