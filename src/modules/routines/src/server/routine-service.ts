import type { ConversationService } from '@emanator/conversations/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { type Routine, validateRoutineInput } from '../domain/routine.ts';
import type { RoutineRun } from '../domain/run.ts';
import { topicTitle } from './messages.ts';
import type { RoutineRunner } from './routine-runner.ts';
import { RoutineScheduler } from './routine-scheduler.ts';
import type { RoutineStore } from './routine-store.ts';

export interface RoutineServiceDeps {
  store: RoutineStore;
  runner: Pick<RoutineRunner, 'start' | 'stop'>;
  conversations: Pick<ConversationService, 'archive' | 'renameRoutineTopic'>;
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

  /** Stops firing new Runs, ends quota waits and waits for the Runs in progress. */
  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.deps.runner.stop();
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
    const valid = validateRoutineInput(input);
    const before = await this.deps.store.get(id);
    const routine = await this.deps.store.update(id, valid);
    if (!routine) return undefined;
    this.scheduler.schedule(routine);
    if (before && before.name !== routine.name && routine.conversationId) {
      await this.renameTopic(routine.conversationId, routine.name);
    }
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

  /** Best-effort: the rename is saved even if Telegram can't follow it right now. */
  private async renameTopic(conversationId: string, name: string): Promise<void> {
    try {
      await this.deps.conversations.renameRoutineTopic(conversationId, name, topicTitle(name));
    } catch (error) {
      this.deps.logger.warn('Could not rename the Routine topic', {
        name,
        error: errorMessage(error),
      });
    }
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
