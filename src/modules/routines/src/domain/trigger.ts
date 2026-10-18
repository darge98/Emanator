import { Cron } from 'croner';
import { RoutineValidationError } from './errors.ts';

/** When a Routine runs: a specific date, a fixed interval or a cron expression. */
export type Trigger = OnceTrigger | IntervalTrigger | CronTrigger;

export interface OnceTrigger {
  type: 'once';
  /** ISO 8601 with an explicit offset, e.g. `2026-10-19T08:00:00+02:00`. */
  at: string;
}

export interface IntervalTrigger {
  type: 'interval';
  everyMinutes: number;
}

export interface CronTrigger {
  type: 'cron';
  /** Five fields (minute resolution), read in the Harness time zone. */
  expression: string;
}

/** One year: longer intervals are better expressed as a date or a cron expression. */
const MAX_INTERVAL_MINUTES = 525_600;

export function validateTrigger(input: unknown): Trigger {
  const value = (input ?? {}) as Record<string, unknown>;
  switch (value.type) {
    case 'once': {
      const at = value.at;
      if (typeof at !== 'string' || !isRealDateTime(at)) {
        throw new RoutineValidationError(
          'A date Trigger needs a real ISO date and time with offset.',
        );
      }
      return { type: 'once', at };
    }
    case 'interval': {
      const every = value.everyMinutes;
      if (
        !Number.isInteger(every) ||
        (every as number) < 1 ||
        (every as number) > MAX_INTERVAL_MINUTES
      ) {
        throw new RoutineValidationError(
          `An interval must be a whole number of minutes between 1 and ${MAX_INTERVAL_MINUTES}.`,
        );
      }
      return { type: 'interval', everyMinutes: every as number };
    }
    case 'cron': {
      const expression = typeof value.expression === 'string' ? value.expression.trim() : '';
      if (expression.split(/\s+/).length !== 5) {
        throw new RoutineValidationError('A cron expression needs exactly five fields.');
      }
      try {
        new Cron(expression);
      } catch (error) {
        throw new RoutineValidationError(`Invalid cron expression: ${(error as Error).message}`);
      }
      return { type: 'cron', expression };
    }
    default:
      throw new RoutineValidationError('A Trigger is a date, an interval or a cron expression.');
  }
}

/** ISO 8601 with offset whose fields exist: `Date.parse` would roll 30 February into March. */
function isRealDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => Number(part ?? 0));
  const date = new Date(0);
  date.setUTCFullYear(year as number, (month as number) - 1, day);
  date.setUTCHours(hour as number, minute, second);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month as number) - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

/**
 * The first time strictly after `after` that the Trigger fires, or undefined if it never will.
 * Intervals count from `anchor`, so their rhythm survives restarts.
 */
export function nextFire(
  trigger: Trigger,
  after: Date,
  { anchor, timeZone }: { anchor: Date; timeZone: string },
): Date | undefined {
  switch (trigger.type) {
    case 'once': {
      const at = new Date(trigger.at);
      return at > after ? at : undefined;
    }
    case 'interval': {
      const every = trigger.everyMinutes * 60_000;
      const elapsed = after.getTime() - anchor.getTime();
      const steps = elapsed < 0 ? 1 : Math.floor(elapsed / every) + 1;
      return new Date(anchor.getTime() + steps * every);
    }
    case 'cron':
      return new Cron(trigger.expression, { timezone: timeZone }).nextRun(after) ?? undefined;
  }
}
