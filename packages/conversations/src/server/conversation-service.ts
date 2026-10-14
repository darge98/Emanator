import {
  type Channel,
  type InboundCommand,
  type InboundEvent,
  ThreadNotFoundError,
} from '@emanator/channels';
import type { Engine, PermissionDecider, UsageTracker } from '@emanator/engine';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { type Conversation, GENERAL_CONVERSATION_NAME } from '../domain/conversation.ts';
import { type ConversationStore, slugify } from './conversation-store.ts';
import { KeyedQueue } from './keyed-queue.ts';
import * as say from './messages.ts';

export interface ConversationServiceDeps {
  channel: Channel;
  engine: Engine;
  store: ConversationStore;
  usage: UsageTracker;
  /** Built fresh for every turn, so it can carry the current date and time. */
  systemPrompt: () => string;
  defaultModel: string;
  /** IANA time zone used when showing times to the Owner, e.g. `Europe/Rome`. */
  timeZone: string;
  logger: Logger;
}

// No Tools are exposed yet, so nothing should ever ask; Policies arrive with their own module.
const denyAllTools: PermissionDecider = async () => ({
  behavior: 'deny',
  reason: 'No Tools are enabled yet.',
});

/**
 * Where a Channel meets the Engine: every thread maps to a Conversation whose
 * Engine session is resumed turn after turn. Messages of one Conversation are
 * handled in order; different Conversations run in parallel.
 */
export class ConversationService {
  private readonly queue = new KeyedQueue();

  constructor(private readonly deps: ConversationServiceDeps) {}

  /** Returns at once; the event is processed in its thread's queue. */
  handle(event: InboundEvent): void {
    void this.queue.run(event.threadId ?? '', () => this.processSafely(event));
  }

  /** Resolves when everything received so far has been handled. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  /**
   * A failure outside the Engine (opening a topic, sending, the database) is logged and
   * the Owner gets a generic notice instead of silence. Never rejects, so the queue goes on.
   */
  private async processSafely(event: InboundEvent): Promise<void> {
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

  private async process(event: InboundEvent): Promise<void> {
    const conversation = this.resolve(event.threadId);
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
      const sessionLost = await this.turn(conversation, text);
      if (sessionLost) {
        // The Engine no longer has this session (e.g. its storage was wiped): start over, once.
        store.setSession(conversation.id, undefined);
        const { session: _lost, ...fresh } = conversation;
        await this.turn(fresh, text, say.sessionLost);
      }
    } finally {
      await channel.showProgress(conversation.threadId, null);
    }
  }

  /**
   * Runs one Engine turn and replies with its outcome, after `preface` if given.
   * Returns true, without replying, when the session to resume no longer exists.
   */
  private async turn(conversation: Conversation, text: string, preface?: string): Promise<boolean> {
    const { channel, engine, store, usage } = this.deps;
    const model = this.modelOf(conversation);
    const withPreface = (markdown: string) => (preface ? `${preface}\n\n${markdown}` : markdown);

    for await (const event of engine.runTurn({
      prompt: text,
      systemPrompt: this.deps.systemPrompt(),
      model,
      ...(conversation.session && { session: conversation.session }),
      decidePermission: denyAllTools,
    })) {
      switch (event.type) {
        case 'turn.started':
          store.setSession(conversation.id, event.session);
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
        this.deps.store.setSession(conversation.id, undefined);
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
    const topic = store.create({
      name: store.availableName(slugify(title)),
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
    try {
      await this.deps.channel.send(conversation.threadId, { markdown });
    } catch (error) {
      if (!(error instanceof ThreadNotFoundError)) throw error;
      this.deps.store.archive(conversation.id);
      this.deps.logger.warn('Thread is gone, Conversation archived', { name: conversation.name });
    }
  }

  /** The live Conversation of a thread, created on first contact. */
  private resolve(threadId: string | undefined): Conversation {
    const { channel, store } = this.deps;
    const existing = store.findByThread(channel.id, threadId);
    if (existing) return existing;

    if (threadId === undefined) {
      return store.create({
        name: store.availableName(GENERAL_CONVERSATION_NAME),
        title: say.GENERAL_TITLE,
        channel: channel.id,
        openedBy: 'harness',
      });
    }
    // A topic the Harness doesn't know, e.g. opened before the state was reset.
    return store.create({
      name: store.availableName(`topic-${threadId}`),
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
