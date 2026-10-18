import type { ConversationService } from '@emanator/conversations/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { type Routine, validateRoutineInput } from '../domain/routine.ts';
import type { RoutineRun } from '../domain/run.ts';
import type { RoutineRunner } from './routine-runner.ts';
import { RoutineScheduler } from './routine-scheduler.ts';
import type { RoutineStore } from './routine-store.ts';

export interface RoutineServiceDeps {
  store: RoutineStore;
  runner: Pick<RoutineRunner, 'start' | 'idle'>;
  conversations: Pick<ConversationService, 'archive'>;
  /** IANA zone cron expressions are read in. */
  timeZone: string;
  logger: Logger;
  now?: () => Date;
}

/** A Routine as the dashboard shows it. */
export interface RoutineView extends Routine {
  nextRunAt?: Date;
}

/**
 * What the dashboard does with Routines. Every change reschedules the Routine at
 * once, so creating, editing or deleting one never needs a restart.
 */
export class RoutineService {
  private readonly scheduler: RoutineScheduler;

  constructor(private readonly deps: RoutineServiceDeps) {
    this.scheduler = new RoutineScheduler({
      timeZone: deps.timeZone,
      onFire: (routineId) => this.fire(routineId),
      ...(deps.now && { now: deps.now }),
    });
  }

  /** Schedules every Routine; Runs a previous Harness left unfinished are marked failed. */
  async start(): Promise<void> {
    await this.deps.store.failInterruptedRuns();
    for (const routine of await this.deps.store.list()) this.scheduler.schedule(routine);
  }

  /** Stops firing new Runs and waits for the ones in progress. */
  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.deps.runner.idle();
  }

  async list(): Promise<RoutineView[]> {
    return (await this.deps.store.list()).map((routine) => this.view(routine));
  }

  async get(id: string): Promise<RoutineView | undefined> {
    const routine = await this.deps.store.get(id);
    return routine && this.view(routine);
  }

  /** Throws RoutineValidationError or RoutineNameTakenError. */
  async create(input: unknown): Promise<RoutineView> {
    const routine = await this.deps.store.create(validateRoutineInput(input));
    this.scheduler.schedule(routine);
    return this.view(routine);
  }

  /** Undefined when the Routine doesn't exist; throws like `create`. */
  async update(id: string, input: unknown): Promise<RoutineView | undefined> {
    const routine = await this.deps.store.update(id, validateRoutineInput(input));
    if (!routine) return undefined;
    this.scheduler.schedule(routine);
    return this.view(routine);
  }

  /** Archives the Routine's topic Conversation; the Telegram topic stays for the Owner. */
  async delete(id: string): Promise<boolean> {
    this.scheduler.unschedule(id);
    const routine = await this.deps.store.delete(id);
    if (!routine) return false;
    if (routine.conversationId) await this.deps.conversations.archive(routine.conversationId);
    return true;
  }

  /** Starts a Run now, in the background; undefined when the Routine doesn't exist. */
  runNow(id: string): Promise<RoutineRun | undefined> {
    return this.deps.runner.start(id, 'manual');
  }

  async runs(id: string): Promise<RoutineRun[] | undefined> {
    if (!(await this.deps.store.get(id))) return undefined;
    return this.deps.store.runs(id);
  }

  private fire(routineId: string): void {
    this.deps.runner.start(routineId, 'schedule').catch((error) => {
      this.deps.logger.error('Could not start a scheduled Run', {
        routineId,
        error: errorMessage(error),
      });
    });
  }

  private view(routine: Routine): RoutineView {
    const nextRunAt = this.scheduler.nextRun(routine);
    return { ...routine, ...(nextRunAt && { nextRunAt }) };
  }
}
