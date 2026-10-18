import {
  type Channel,
  type InboundAction,
  type InboundCommand,
  type InboundEvent,
  ThreadNotFoundError,
} from '@emanator/channels';
import type { Engine, PermissionDecider, UsageTracker } from '@emanator/engine';
import { errorMessage, type Logger } from '@emanator/shared/server';
import {
  type Conversation,
  GENERAL_CONVERSATION_NAME,
  ROUTINE_TOPIC_SUFFIX,
  slugify,
} from '../domain/conversation.ts';
import type { ConversationStore } from './conversation-store.ts';
import { KeyedQueue } from './keyed-queue.ts';
import * as say from './messages.ts';

export interface ConversationServiceDeps {
  channel: Channel;
  engine: Engine;
  store: ConversationStore;
  usage: UsageTracker;
  /** Built fresh for every turn, so it can carry the current date and time. */
  systemPrompt: () => Promise<string> | string;
  defaultModel: string;
  /** IANA time zone used when showing times to the Owner, e.g. `Europe/Rome`. */
  timeZone: string;
  /** The PermissionDecider of each turn, from Policies. */
  permissions: PermissionsFor;
  logger: Logger;
}

/** Builds the PermissionDecider of one turn. */
export type PermissionsFor = (context: TurnContext) => PermissionDecider;

export interface TurnContext {
  /** The thread to ask the Owner in; may open it. Undefined is General. */
  thread: () => Promise<string | undefined>;
  /** Called while the turn waits for the Owner's answer. */
  onWaiting?: (waiting: boolean) => void | Promise<void>;
}

const routineTopicName = (routineName: string) => `${slugify(routineName)}${ROUTINE_TOPIC_SUFFIX}`;

/**
 * What the Owner sends into a Conversation. Button presses are left out: they answer a
 * turn that may be holding the Conversation's queue, so they must not wait in it.
 */
export type ConversationEvent = Exclude<InboundEvent, InboundAction>;

/** Routine messages kept for one turn at most; older ones are dropped. */
const MAX_HANDOFFS = 10;

/**
 * Where a Channel meets the Engine: every thread maps to a Conversation whose
 * Engine session is resumed turn after turn. Messages of one Conversation are
 * handled in order; different Conversations run in parallel.
 */
export class ConversationService {
  private readonly queue = new KeyedQueue();

  constructor(private readonly deps: ConversationServiceDeps) {}

  /** Returns at once; the event is processed in its thread's queue. */
  handle(event: ConversationEvent): void {
    void this.queue.run(event.threadId ?? '', () => this.processSafely(event));
  }

  /** Resolves when everything received so far has been handled. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** The Conversation with this id while it is live. */
  async findLive(id: string): Promise<Conversation | undefined> {
    const conversation = await this.deps.store.get(id);
    return conversation && !conversation.archivedAt ? conversation : undefined;
  }

  /** Opens the topic of the Routine called `routineName`, named `<slug>-routine`. */
  async openRoutineTopic(routineName: string, title: string): Promise<Conversation> {
    const { channel, store } = this.deps;
    const threadId = await channel.openThread(title);
    return store.create({
      name: routineTopicName(routineName),
      title,
      channel: channel.id,
      threadId,
      openedBy: 'harness',
      routineTopic: true,
    });
  }

  /**
   * Follows a Routine rename: the topic and its Conversation take the new name.
   * A topic found deleted is archived instead, so the next Run opens a new one.
   */
  async renameRoutineTopic(id: string, routineName: string, title: string): Promise<void> {
    const conversation = await this.findLive(id);
    if (!conversation?.threadId) return;
    try {
      await this.deps.channel.renameThread(conversation.threadId, title);
    } catch (error) {
      if (!(error instanceof ThreadNotFoundError)) throw error;
      await this.deps.store.archive(id);
      return;
    }
    await this.deps.store.rename(id, routineTopicName(routineName), title);
  }

  /**
   * Sends a message the Owner didn't ask for, such as a Routine's, and hands it to the
   * Conversation's next turn. Returns false, after archiving it, if the thread is gone.
   */
  async deliver(conversation: Conversation, markdown: string): Promise<boolean> {
    if (!(await this.trySend(conversation, markdown))) return false;
    try {
      await this.deps.store.addHandoff(conversation.id, markdown, MAX_HANDOFFS);
    } catch (error) {
      // The Owner has the message already; only its context for the next turn is lost.
      this.deps.logger.error('Could not hand a delivered message to its Conversation', {
        name: conversation.name,
        error: errorMessage(error),
      });
    }
    return true;
  }

  /** Sends a notice from the Harness itself, which stays out of the Conversation's context. */
  async notify(conversation: Conversation, markdown: string): Promise<boolean> {
    return this.trySend(conversation, markdown);
  }

  async archive(id: string): Promise<void> {
    await this.deps.store.archive(id);
  }

  /**
   * A failure outside the Engine (opening a topic, sending, the database) is logged and
   * the Owner gets a generic notice instead of silence. Never rejects, so the queue goes on.
   */
  private async processSafely(event: ConversationEvent): Promise<void> {
    try {
      await this.process(event);
    } catch (error) {
      this.deps.logger.error('Could not handle an inbound event', {
        type: event.type,
        error: errorMessage(error),
      });
      try {
        await this.deps.channel.send(event.threadId, { markdown: say.handlingFailed });
      } catch (noticeError) {
        this.deps.logger.error('Could not send the failure notice either', {
          error: errorMessage(noticeError),
        });
      }
    }
  }

  private async process(event: ConversationEvent): Promise<void> {
    const conversation = await this.resolve(event.threadId);
    switch (event.type) {
      case 'message':
        return this.converse(conversation, event.text);
      case 'command':
        return this.command(conversation, event);
      case 'unsupported':
        return this.reply(conversation, say.unsupported(event.kind));
    }
  }

  private async converse(conversation: Conversation, text: string): Promise<void> {
    const { channel, store } = this.deps;
    await channel.showProgress(conversation.threadId, say.thinking);
    try {
      // Resolve once before entering the Engine. A persona change during this turn
      // takes effect on the next queued turn, including after a lost-session retry.
      const prompt = await this.deps.systemPrompt();
      const handoffs = await store.pendingHandoffs(conversation.id);
      const input = say.withHandoffs(handoffs, text, this.deps.timeZone);
      const handedOff = async () => {
        if (handoffs.length) {
          await store.clearHandoffs(
            conversation.id,
            handoffs.map(({ id }) => id),
          );
        }
      };
      const sessionLost = await this.turn(conversation, input, prompt, handedOff);
      if (sessionLost) {
        // The Engine no longer has this session (e.g. its storage was wiped): start over, once.
        await store.setSession(conversation.id, undefined);
        const { session: _lost, ...fresh } = conversation;
        await this.turn(fresh, input, prompt, handedOff, say.sessionLost);
      }
    } finally {
      await channel.showProgress(conversation.threadId, null);
    }
  }

  /**
   * Runs one Engine turn and replies with its outcome, after `preface` if given.
   * `started` runs once the Engine has accepted the prompt.
   * Returns true, without replying, when the session to resume no longer exists.
   */
  private async turn(
    conversation: Conversation,
    text: string,
    systemPrompt: string,
    started: () => Promise<void>,
    preface?: string,
  ): Promise<boolean> {
    const { channel, engine, store, usage } = this.deps;
    const model = this.modelOf(conversation);
    const withPreface = (markdown: string) => (preface ? `${preface}\n\n${markdown}` : markdown);

    for await (const event of engine.runTurn({
      prompt: text,
      systemPrompt,
      model,
      ...(conversation.session && { session: conversation.session }),
      decidePermission: this.deps.permissions({ thread: async () => conversation.threadId }),
    })) {
      switch (event.type) {
        case 'turn.started':
          await store.setSession(conversation.id, event.session);
          await started();
          break;
        case 'tool.called':
          await channel.showProgress(conversation.threadId, say.usingTool(event.tool));
          break;
        case 'usage.limit':
          usage.record(event);
          break;
        case 'turn.completed':
          await this.reply(conversation, withPreface(event.text));
          break;
        case 'turn.failed':
          if (event.reason === 'session-not-found' && conversation.session) return true;
          await this.reply(
            conversation,
            withPreface(say.failure(event, model, usage.latest(), this.deps.timeZone)),
          );
          break;
      }
    }
    return false;
  }

  private async command(conversation: Conversation, command: InboundCommand): Promise<void> {
    switch (command.name) {
      case 'new':
        await this.deps.store.setSession(conversation.id, undefined);
        await this.deps.store.clearHandoffs(conversation.id);
        return this.reply(conversation, say.contextReset);
      case 'topic':
        return this.openTopic(conversation, command.args);
      case 'status':
        return this.reply(
          conversation,
          say.status(
            conversation,
            this.modelOf(conversation),
            this.deps.usage.latest(),
            this.deps.timeZone,
          ),
        );
      case 'start':
      case 'help':
        return this.reply(conversation, say.help());
      default:
        return this.reply(conversation, say.unknownCommand(command.name));
    }
  }

  private async openTopic(from: Conversation, title: string): Promise<void> {
    if (!title) return this.reply(from, say.topicUsage);

    const { channel, store } = this.deps;
    const threadId = await channel.openThread(title);
    const topic = await store.create({
      name: slugify(title),
      title,
      channel: channel.id,
      threadId,
      openedBy: 'owner',
    });
    await this.reply(topic, say.topicWelcome(title));
    await this.reply(from, say.topicOpened(title));
  }

  /** Sends to the Conversation's thread; a thread deleted by the Owner archives it. */
  private async reply(conversation: Conversation, markdown: string): Promise<void> {
    await this.trySend(conversation, markdown);
  }

  /** Like `reply`, returning whether the message was sent. */
  private async trySend(conversation: Conversation, markdown: string): Promise<boolean> {
    try {
      await this.deps.channel.send(conversation.threadId, { markdown });
      return true;
    } catch (error) {
      if (!(error instanceof ThreadNotFoundError)) throw error;
      await this.deps.store.archive(conversation.id);
      this.deps.logger.warn('Thread is gone, Conversation archived', { name: conversation.name });
      return false;
    }
  }

  /** The live Conversation of a thread, created on first contact. */
  private async resolve(threadId: string | undefined): Promise<Conversation> {
    const { channel, store } = this.deps;
    const existing = await store.findByThread(channel.id, threadId);
    if (existing) return existing;

    if (threadId === undefined) {
      return store.create({
        name: GENERAL_CONVERSATION_NAME,
        title: say.GENERAL_TITLE,
        channel: channel.id,
        openedBy: 'harness',
      });
    }
    // A topic the Harness doesn't know, e.g. opened before the state was reset.
    return store.create({
      name: `topic-${threadId}`,
      title: `Topic ${threadId}`,
      channel: channel.id,
      threadId,
      openedBy: 'owner',
    });
  }

  private modelOf(conversation: Conversation): string {
    return conversation.model ?? this.deps.defaultModel;
  }
}
