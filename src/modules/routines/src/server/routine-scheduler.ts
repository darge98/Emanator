import type { Routine } from '../domain/routine.ts';
import { nextFire, type Trigger } from '../domain/trigger.ts';

/** setTimeout's ceiling (about 24.8 days); longer waits are split. */
const MAX_DELAY_MS = 2 ** 31 - 1;

export interface RoutineSchedulerDeps {
  /** IANA zone cron expressions are read in. */
  timeZone: string;
  /** Called when a Trigger fires; must not throw. */
  onFire: (routineId: string) => void;
  now?: () => Date;
}

/**
 * Keeps one timer per Trigger of every enabled Routine. Rescheduling replaces a
 * Routine's timers at once, so edits apply without a restart. Events that would have
 * fired while the Harness was down are skipped: timers always start from now.
 */
export class RoutineScheduler {
  private readonly timers = new Map<string, Set<NodeJS.Timeout>>();
  private readonly now: () => Date;

  constructor(private readonly deps: RoutineSchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** (Re)arms the Routine's Triggers; a disabled Routine is only unscheduled. */
  schedule(routine: Routine): void {
    this.unschedule(routine.id);
    if (!routine.enabled) return;
    const timers = new Set<NodeJS.Timeout>();
    this.timers.set(routine.id, timers);
    for (const trigger of routine.triggers) this.arm(routine, trigger, this.now(), timers);
  }

  unschedule(routineId: string): void {
    for (const timer of this.timers.get(routineId) ?? []) clearTimeout(timer);
    this.timers.delete(routineId);
  }

  stop(): void {
    for (const routineId of [...this.timers.keys()]) this.unschedule(routineId);
  }

  /** When the Routine runs next, if ever. */
  nextRun(routine: Routine): Date | undefined {
    if (!routine.enabled) return undefined;
    const now = this.now();
    return routine.triggers
      .map((trigger) => this.next(routine, trigger, now))
      .filter((date): date is Date => date !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())[0];
  }

  private arm(routine: Routine, trigger: Trigger, after: Date, timers: Set<NodeJS.Timeout>): void {
    const at = this.next(routine, trigger, after);
    if (!at) return;
    const wait = (target: Date) => {
      const delay = target.getTime() - this.now().getTime();
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          if (this.timers.get(routine.id) !== timers) return; // rescheduled meanwhile
          if (delay > MAX_DELAY_MS) return wait(target);
          this.deps.onFire(routine.id);
          // Count from the planned time, so an early timer can't fire the same Event twice.
          const now = this.now();
          this.arm(routine, trigger, now > target ? now : target, timers);
        },
        Math.max(0, Math.min(delay, MAX_DELAY_MS)),
      );
      timers.add(timer);
    };
    wait(at);
  }

  private next(routine: Routine, trigger: Trigger, after: Date): Date | undefined {
    return nextFire(trigger, after, { anchor: routine.updatedAt, timeZone: this.deps.timeZone });
  }
}
