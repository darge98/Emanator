import type { Conversation } from '@emanator/conversations';
import type { ConversationService } from '@emanator/conversations/server';
import type {
  Engine,
  PermissionDecider,
  SessionRef,
  TurnFailed,
  UsageTracker,
} from '@emanator/engine';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { type Routine, SILENT_REPLY } from '../domain/routine.ts';
import type { RoutineRun, RunOrigin } from '../domain/run.ts';
import * as say from './messages.ts';
import type { RoutineStore, RunOutcome } from './routine-store.ts';

export interface RoutineRunnerDeps {
  engine: Engine;
  conversations: Pick<
    ConversationService,
    'general' | 'findLive' | 'openRoutineTopic' | 'deliver' | 'notify'
  >;
  store: RoutineStore;
  usage: UsageTracker;
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

// No Tools are exposed yet, so nothing should ever ask; Policies arrive with their own module.
const denyAllTools: PermissionDecider = async () => ({
  behavior: 'deny',
  reason: 'No Tools are enabled yet.',
});

type TurnResult =
  | { ok: true; text: string; session?: SessionRef; tools: string[] }
  | { ok: false; failure: TurnFailed; session?: SessionRef; tools: string[] };

/**
 * Executes Runs: one Engine turn in a fresh session, whose reply is delivered to
 * General or to the Routine's own topic. Runs execute in parallel, even of one Routine.
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
    const run = await this.deps.store.startRun(routine.id, origin);
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

  /** Never rejects: whatever happens ends up in the Run history. */
  private async execute(routine: Routine, run: RoutineRun): Promise<void> {
    let outcome: RunOutcome;
    try {
      outcome = await this.perform(routine, run);
    } catch (error) {
      outcome = { status: 'failed', tools: [], error: errorMessage(error) };
      this.deps.logger.error('Routine Run failed', { routine: routine.name, error: outcome.error });
    }
    try {
      await this.deps.store.finishRun(run.id, outcome);
    } catch (error) {
      this.deps.logger.error('Could not record the end of a Run', {
        routine: routine.name,
        error: errorMessage(error),
      });
    }
  }

  private async perform(routine: Routine, run: RoutineRun): Promise<RunOutcome> {
    let result: TurnResult;
    for (let waits = 0; ; waits++) {
      await this.waitForQuota(run);
      result = await this.turn(routine, run.origin);
      if (result.ok || result.failure.reason !== 'usage-limit' || waits >= MAX_QUOTA_WAITS) break;
      this.blockedUntil = this.resetTime();
    }
    const { session, tools } = result;
    const base = { tools, ...(session && { session }) };

    if (!result.ok) {
      const delivered = await this.deliver(
        routine,
        say.runFailed(routine.name, result.failure.reason),
      ).catch((error) => {
        this.deps.logger.error('Could not send the Run failure notice', {
          routine: routine.name,
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

    const delivered = await this.deliver(routine, say.withHeader(routine.name, result.text));
    if (!delivered) {
      return { ...base, status: 'failed', error: 'The message could not be delivered.' };
    }
    return { ...base, status: 'delivered', conversationId: delivered.id };
  }

  /** Waits while the quota is known to be exhausted, telling the Owner once per reset. */
  private async waitForQuota(run: RoutineRun): Promise<void> {
    const until = this.blockedUntil;
    const delay = until ? until.getTime() - this.now().getTime() : 0;
    if (!until || delay <= 0) return;
    await this.deps.store.setRunStatus(run.id, 'waiting');
    if (this.noticeFor !== until.getTime()) {
      this.noticeFor = until.getTime();
      await this.noticeQuota(until);
    }
    await this.sleep(delay, this.stopping.signal);
    await this.deps.store.setRunStatus(run.id, 'running');
  }

  private async noticeQuota(until: Date): Promise<void> {
    try {
      const general = await this.deps.conversations.general();
      await this.deps.conversations.notify(general, say.quotaExhausted(until, this.deps.timeZone));
    } catch (error) {
      this.deps.logger.error('Could not send the quota notice', { error: errorMessage(error) });
    }
  }

  /** When to retry: just after the reset the Engine last reported, within sane bounds. */
  private resetTime(): Date {
    const now = this.now().getTime();
    const resetsAt = this.deps.usage.latest()?.resetsAt?.getTime();
    const wait =
      resetsAt && resetsAt > now ? resetsAt - now + RESET_MARGIN_MS : UNKNOWN_RESET_WAIT_MS;
    return new Date(now + Math.min(wait, MAX_WAIT_MS));
  }

  private async turn(routine: Routine, origin: RunOrigin): Promise<TurnResult> {
    const { engine, usage } = this.deps;
    const systemPrompt = [
      await this.deps.systemPrompt(),
      say.runInstructions(routine, origin),
    ].join('\n');
    const tools: string[] = [];
    let session: SessionRef | undefined;

    for await (const event of engine.runTurn({
      prompt: routine.prompt,
      systemPrompt,
      model: routine.model ?? this.deps.defaultModel,
      decidePermission: denyAllTools,
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
   * Sends to General, or to the Routine's own topic, opening it if needed. A topic
   * found deleted while sending is replaced once. Returns where the message landed.
   */
  private async deliver(routine: Routine, markdown: string): Promise<Conversation | undefined> {
    const { conversations } = this.deps;
    if (!routine.dedicatedTopic) {
      const general = await conversations.general();
      return (await conversations.deliver(general, markdown)) ? general : undefined;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const topic = await this.topic(routine);
      if (await conversations.deliver(topic, markdown)) return topic;
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
