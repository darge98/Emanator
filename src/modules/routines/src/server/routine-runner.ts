import type { Conversation } from '@emanator/conversations';
import type { ConversationService, PrepareTurn } from '@emanator/conversations/server';
import type { Engine, SessionRef, TurnFailed, UsageTracker } from '@emanator/engine';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { type Routine, SILENT_REPLY } from '../domain/routine.ts';
import type { RoutineRun, RunOrigin } from '../domain/run.ts';
import * as say from './messages.ts';
import type { RoutineStore, RunOutcome } from './routine-store.ts';

export interface RoutineRunnerDeps {
  engine: Engine;
  conversations: Pick<ConversationService, 'findLive' | 'openRoutineTopic' | 'deliver' | 'notify'>;
  store: RoutineStore;
  usage: UsageTracker;
  /** The Tools of each Run, the Engine's included, and its PermissionDecider. */
  prepareTurn: PrepareTurn;
  /** The Agent's system prompt, built fresh for every Run. */
  systemPrompt: () => Promise<string> | string;
  defaultModel: string;
  /** IANA zone used when telling the Owner when Runs resume. */
  timeZone: string;
  logger: Logger;
  now?: () => Date;
  /** Waits `ms`, rejecting early when `signal` aborts. Replaceable in tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** How many quota resets one Run waits for before giving up. */
const MAX_QUOTA_WAITS = 3;
/** When the Engine doesn't say when the quota resets. */
const UNKNOWN_RESET_WAIT_MS = 30 * 60_000;
/** A little past the reset, so the first retry doesn't hit the old limit. */
const RESET_MARGIN_MS = 60_000;
/** The longest limit window is seven days. */
const MAX_WAIT_MS = 8 * 24 * 60 * 60_000;

class StoppedError extends Error {
  constructor() {
    super('The Harness stopped while the Run waited for the quota reset.');
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new StoppedError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StoppedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

type TurnResult =
  | { ok: true; text: string; session?: SessionRef; tools: string[] }
  | { ok: false; failure: TurnFailed; session?: SessionRef; tools: string[] };

/**
 * Executes Runs: one Engine turn in a fresh session, whose reply is delivered to the
 * Routine's own topic. Runs execute in parallel, even of one Routine.
 * When the quota is exhausted, Runs wait for its reset and the Owner gets one notice.
 */
export class RoutineRunner {
  private readonly inFlight = new Set<Promise<void>>();
  /** Opening a Routine's topic, so parallel Runs share one topic. */
  private readonly opening = new Map<string, Promise<Conversation>>();
  private readonly stopping = new AbortController();
  /** Until when the quota is known to be exhausted. */
  private blockedUntil: Date | undefined;
  /** The reset time the Owner was last told about. */
  private noticeFor: number | undefined;
  private readonly now: () => Date;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly deps: RoutineRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? abortableSleep;
  }

  /** Records the Run and executes it in the background; undefined if the Routine is gone. */
  async start(routineId: string, origin: RunOrigin): Promise<RoutineRun | undefined> {
    const routine = await this.deps.store.get(routineId);
    if (!routine) return undefined;
    let run: RoutineRun;
    try {
      run = await this.deps.store.startRun(routine.id, origin);
    } catch (error) {
      // Deleted between the read and the insert.
      if ((error as { code?: string }).code === '23503') return undefined;
      throw error;
    }
    const execution = this.execute(routine, run).finally(() => this.inFlight.delete(execution));
    this.inFlight.add(execution);
    return run;
  }

  /** Resolves when every Run started so far has finished. */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.all(this.inFlight);
  }

  /** Ends quota waits at once (those Runs fail), then waits for the Runs in progress. */
  async stop(): Promise<void> {
    this.stopping.abort();
    await this.idle();
  }

  /** Never rejects: whatever happens ends up in the Run history, and every failure in the log. */
  private async execute(routine: Routine, run: RoutineRun): Promise<void> {
    let outcome: RunOutcome;
    try {
      outcome = await this.perform(routine, run);
    } catch (error) {
      outcome = { status: 'failed', tools: [], error: errorMessage(error) };
    }
    if (outcome.status === 'failed') {
      this.deps.logger.error('Routine Run failed', {
        routine: routine.name,
        run: run.id,
        error: outcome.error,
      });
    }
    try {
      await this.deps.store.finishRun(run.id, outcome);
    } catch (error) {
      this.deps.logger.error('Could not record the end of a Run', {
        routine: routine.name,
        run: run.id,
        error: errorMessage(error),
      });
    }
  }

  private async perform(routine: Routine, run: RoutineRun): Promise<RunOutcome> {
    let result: TurnResult;
    for (let waits = 0; ; waits++) {
      await this.waitForQuota(routine, run);
      result = await this.turn(routine, run);
      if (result.ok || result.failure.reason !== 'usage-limit' || waits >= MAX_QUOTA_WAITS) break;
      this.blockForQuota();
    }
    const { session, tools } = result;
    const base = { tools, ...(session && { session }) };

    // The Routine may have been renamed or deleted while the Run worked or waited.
    const current = await this.deps.store.get(routine.id);
    if (!current) {
      return { ...base, status: 'failed', error: 'The Routine was deleted during the Run.' };
    }

    if (!result.ok) {
      const delivered = await this.deliver(
        current,
        say.runFailed(current.name, result.failure.reason),
      ).catch((error) => {
        this.deps.logger.error('Could not send the Run failure notice', {
          routine: current.name,
          error: errorMessage(error),
        });
        return undefined;
      });
      return {
        ...base,
        status: 'failed',
        error: result.failure.message,
        ...(delivered && { conversationId: delivered.id }),
      };
    }
    if (result.text.trim() === SILENT_REPLY) return { ...base, status: 'silent' };

    const delivered = await this.deliver(current, say.withHeader(current.name, result.text));
    if (!delivered) {
      return { ...base, status: 'failed', error: 'The message could not be delivered.' };
    }
    return { ...base, status: 'delivered', conversationId: delivered.id };
  }

  /**
   * Waits while the quota is known to be exhausted, telling the Owner once per reset in
   * the Routine's topic. Keeps waiting if the wait is extended meanwhile.
   */
  private async waitForQuota(routine: Routine, run: RoutineRun): Promise<void> {
    let waiting = false;
    for (;;) {
      const until = this.blockedUntil;
      const delay = until ? until.getTime() - this.now().getTime() : 0;
      if (!until || delay <= 0) break;
      if (!waiting) {
        waiting = true;
        await this.deps.store.setRunStatus(run.id, 'waiting');
      }
      if (this.noticeFor !== until.getTime()) {
        this.noticeFor = until.getTime();
        await this.noticeQuota(routine, until);
      }
      await this.sleep(delay, this.stopping.signal);
      if (this.blockedUntil === until) break; // not extended while sleeping
    }
    if (waiting) await this.deps.store.setRunStatus(run.id, 'running');
  }

  private async noticeQuota(routine: Routine, until: Date): Promise<void> {
    try {
      const topic = await this.topic(routine);
      await this.deps.conversations.notify(topic, say.quotaExhausted(until, this.deps.timeZone));
    } catch (error) {
      this.deps.logger.error('Could not send the quota notice', {
        routine: routine.name,
        error: errorMessage(error),
      });
    }
  }

  /**
   * Holds Runs until just after the reset the Engine last reported. A wait already in
   * progress is kept unless a known reset comes later, so Runs that fail together share
   * one wait and one notice.
   */
  private blockForQuota(): void {
    const now = this.now().getTime();
    const resetsAt = this.deps.usage.latest()?.resetsAt?.getTime();
    const known = resetsAt !== undefined && resetsAt > now;
    const wait = known ? resetsAt - now + RESET_MARGIN_MS : UNKNOWN_RESET_WAIT_MS;
    const next = new Date(now + Math.min(wait, MAX_WAIT_MS));
    const current = this.blockedUntil;
    if (current && current.getTime() > now && (!known || next <= current)) return;
    this.blockedUntil = next;
  }

  private async turn(routine: Routine, run: RoutineRun): Promise<TurnResult> {
    const { engine, store, usage } = this.deps;
    const systemPrompt = [
      await this.deps.systemPrompt(),
      say.runInstructions(routine, run.origin),
    ].join('\n');
    // Approvals go to the Routine's own topic, opened now if the Run is the first to need it.
    // Parallel Tool calls may wait together: the Run waits until the last one is answered.
    let pendingApprovals = 0;
    const prepared = await this.deps.prepareTurn({
      origin: 'routine',
      tainted: true,
      thread: async () => (await this.topic(routine)).threadId,
      onWaiting: async (waiting) => {
        pendingApprovals += waiting ? 1 : -1;
        if (pendingApprovals === (waiting ? 1 : 0)) {
          await store.setRunStatus(run.id, waiting ? 'approval' : 'running');
        }
      },
    });
    const tools: string[] = [];
    let session: SessionRef | undefined;

    for await (const event of engine.runTurn({
      prompt: routine.prompt,
      systemPrompt,
      model: routine.model ?? this.deps.defaultModel,
      ...prepared,
    })) {
      switch (event.type) {
        case 'turn.started':
          session = event.session;
          break;
        case 'tool.called':
          tools.push(event.tool);
          break;
        case 'usage.limit':
          usage.record(event);
          break;
        case 'turn.completed':
          return { ok: true, text: event.text, session: event.session, tools };
        case 'turn.failed':
          return { ok: false, failure: event, session: event.session ?? session, tools };
      }
    }
    return {
      ok: false,
      failure: { type: 'turn.failed', reason: 'error', message: 'The turn ended without a reply.' },
      session,
      tools,
    };
  }

  /**
   * Sends to the Routine's own topic, opening it if needed. A topic found deleted while
   * sending is replaced once. Returns where the message landed.
   */
  private async deliver(routine: Routine, markdown: string): Promise<Conversation | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const topic = await this.topic(routine);
      if (await this.deps.conversations.deliver(topic, markdown)) return topic;
    }
    return undefined;
  }

  /** The Routine's live topic, opened on first use or after it was archived. */
  private async topic(routine: Routine): Promise<Conversation> {
    const pending = this.opening.get(routine.id);
    if (pending) return pending;
    const opening = this.findOrOpenTopic(routine).finally(() => this.opening.delete(routine.id));
    this.opening.set(routine.id, opening);
    return opening;
  }

  private async findOrOpenTopic(routine: Routine): Promise<Conversation> {
    const { conversations, store } = this.deps;
    // Re-read: a parallel Run may have linked a new topic since this one started.
    const conversationId = (await store.get(routine.id))?.conversationId;
    const live = conversationId ? await conversations.findLive(conversationId) : undefined;
    if (live) return live;
    const topic = await conversations.openRoutineTopic(routine.name, say.topicTitle(routine.name));
    await store.setConversation(routine.id, topic.id);
    return topic;
  }
}
