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
  conversations: Pick<ConversationService, 'general' | 'findLive' | 'openRoutineTopic' | 'deliver'>;
  store: RoutineStore;
  usage: UsageTracker;
  /** The Agent's system prompt, built fresh for every Run. */
  systemPrompt: () => Promise<string> | string;
  defaultModel: string;
  logger: Logger;
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
 */
export class RoutineRunner {
  private readonly inFlight = new Set<Promise<void>>();
  /** Opening a Routine's topic, so parallel Runs share one topic. */
  private readonly opening = new Map<string, Promise<Conversation>>();

  constructor(private readonly deps: RoutineRunnerDeps) {}

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
    const result = await this.turn(routine, run.origin);
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
