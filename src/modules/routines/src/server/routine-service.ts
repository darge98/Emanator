import type { ConversationService } from '@emanator/conversations/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import {
  MAX_PENDING_REMINDERS,
  MAX_REMINDER_DAYS,
  type Routine,
  type RoutineInput,
  RoutineValidationError,
  validateRoutineInput,
} from '../domain/routine.ts';
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

/** A Reminder as the Agent sets it. */
export interface ReminderInput {
  title: string;
  /** ISO 8601 with an explicit offset. */
  at: string;
  /** What the Agent does or says when it fires. */
  prompt: string;
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
    if ((await this.deps.store.get(id))?.kind === 'reminder' && !firesOnce(valid)) {
      throw new RoutineValidationError(
        'A Reminder fires once, at one date: for something recurring, create a Routine.',
      );
    }
    return this.save(id, valid);
  }

  /**
   * Archives the Routine's topic Conversation; the Telegram topic stays for the Owner. A
   * Reminder's Conversation is the Owner's, so it stays as it is.
   */
  async delete(id: string): Promise<boolean> {
    this.scheduler.unschedule(id);
    const routine = await this.deps.store.delete(id);
    if (!routine) return false;
    if (routine.kind === 'routine' && routine.conversationId) {
      await this.deps.conversations.archive(routine.conversationId);
    }
    return true;
  }

  /**
   * A Reminder the Agent sets, fired once in the Conversation it was asked in (General when
   * undefined). Throws RoutineValidationError.
   */
  async remind(input: ReminderInput, conversationId?: string): Promise<RoutineView> {
    // A failed or missed one stays for the Owner to see, but no longer waits.
    const pending = (await this.deps.store.list()).filter(
      (routine) => routine.kind === 'reminder' && this.scheduler.nextRun(routine),
    );
    if (pending.length >= MAX_PENDING_REMINDERS) {
      throw new RoutineValidationError(
        `There are ${MAX_PENDING_REMINDERS} Reminders waiting already: cancel some first.`,
      );
    }
    const reminder = await this.deps.store.create(this.reminderInput(input), {
      kind: 'reminder',
      createdBy: 'agent',
      ...(conversationId && { conversationId }),
    });
    this.scheduler.schedule(reminder);
    return this.view(reminder);
  }

  /** Moves or rewrites a Reminder the Agent set. Throws RoutineValidationError. */
  async updateReminder(id: string, changes: Partial<ReminderInput>): Promise<RoutineView> {
    const reminder = await this.ownedByAgent(id);
    if (reminder.kind !== 'reminder') {
      throw new RoutineValidationError(
        'That is a recurring Routine: cancel it and create it again.',
      );
    }
    const [trigger] = reminder.triggers;
    const input = this.reminderInput({
      title: changes.title ?? reminder.name,
      at: changes.at ?? (trigger?.type === 'once' ? trigger.at : ''),
      prompt: changes.prompt ?? reminder.prompt,
    });
    const saved = await this.save(id, input);
    if (!saved) throw new RoutineValidationError('That Reminder no longer exists.');
    return saved;
  }

  /**
   * A recurring Routine the Agent creates, with its own topic like any other. Throws
   * RoutineValidationError or RoutineNameTakenError.
   */
  async createByAgent(input: unknown): Promise<RoutineView> {
    const valid = validateRoutineInput(input);
    if (valid.triggers.some(({ type }) => type === 'once')) {
      throw new RoutineValidationError(
        'A Routine you create repeats: for something that happens once, set a Reminder.',
      );
    }
    const routine = await this.deps.store.create(valid, { createdBy: 'agent' });
    this.scheduler.schedule(routine);
    return this.view(routine);
  }

  /**
   * Cancels a Reminder, or a recurring Routine, the Agent created; `kind` must match, so each
   * can have its own Policy. Throws RoutineValidationError.
   */
  async cancelByAgent(id: string, kind: Routine['kind']): Promise<Routine> {
    const routine = await this.ownedByAgent(id);
    if (routine.kind !== kind) {
      throw new RoutineValidationError(
        kind === 'reminder'
          ? 'That is a recurring Routine: use cancel_routine.'
          : 'That is a Reminder: use cancel_reminder.',
      );
    }
    await this.delete(id);
    return routine;
  }

  /** Starts a Run now, in the background; undefined when the Routine doesn't exist. */
  runNow(id: string): Promise<RoutineRun | undefined> {
    return this.deps.runner.start(id, 'manual');
  }

  async runs(id: string): Promise<RoutineRun[] | undefined> {
    if (!(await this.deps.store.get(id))) return undefined;
    return this.deps.store.runs(id);
  }

  private async save(id: string, input: RoutineInput): Promise<RoutineView | undefined> {
    const before = await this.deps.store.get(id);
    const routine = await this.deps.store.update(id, input);
    if (!routine) return undefined;
    this.scheduler.schedule(routine);
    if (
      routine.kind === 'routine' &&
      before &&
      before.name !== routine.name &&
      routine.conversationId
    ) {
      await this.renameTopic(routine.conversationId, routine.name);
    }
    return this.view(routine);
  }

  /** The Agent changes only what it created: the Owner's Routines are theirs. */
  private async ownedByAgent(id: string): Promise<Routine> {
    const routine = await this.deps.store.get(id);
    if (!routine) throw new RoutineValidationError('Nothing has this id.');
    if (routine.createdBy !== 'agent') {
      throw new RoutineValidationError(
        'The Owner created it, so only the Owner can change it, from the dashboard.',
      );
    }
    return routine;
  }

  /** A Reminder is a Routine with one Trigger, in the future but not too far. */
  private reminderInput({ title, at, prompt }: ReminderInput): RoutineInput {
    const input = validateRoutineInput({
      name: title,
      prompt,
      enabled: true,
      triggers: [{ type: 'once', at }],
    });
    const when = new Date(at).getTime();
    const now = (this.deps.now?.() ?? new Date()).getTime();
    if (when <= now) throw new RoutineValidationError('The time of a Reminder must be ahead.');
    if (when > now + MAX_REMINDER_DAYS * 86_400_000) {
      throw new RoutineValidationError('A Reminder can be set at most a year ahead.');
    }
    return input;
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

const firesOnce = ({ triggers }: RoutineInput) =>
  triggers.length === 1 && triggers[0]?.type === 'once';
