import { randomInt } from 'node:crypto';
import { type Database, type Logger, runMigrations } from '@emanator/shared/server';
import { autoRetry } from '@grammyjs/auto-retry';
import { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import {
  type Channel,
  type CommandInfo,
  type InboundHandler,
  type OutboundMessage,
  ThreadNotFoundError,
} from '../../domain/channel.ts';
import { toInboundEvent } from './inbound.ts';
import { telegramMigrations } from './migrations.ts';
import { TelegramPairing } from './pairing.ts';
import { isThreadNotFound, shouldFallBackToPlainText } from './send-errors.ts';
import { splitText } from './split-text.ts';

export const TELEGRAM_CHANNEL_ID = 'telegram';

// Drafts disappear after about 30 s, so a long turn has to refresh them.
const DRAFT_REFRESH_MS = 20_000;

export interface TelegramChannelConfig {
  token: string;
  db: Database;
  logger: Logger;
}

interface ActiveDraft {
  id: number;
  status: string;
  timer: NodeJS.Timeout;
}

/**
 * Telegram adapter: one private chat with the Paired Owner, where each thread is a topic
 * (BotFather "Threaded mode") and the General topic is the default thread.
 * Uses long polling, so no public URL is needed.
 */
export class TelegramChannel implements Channel {
  readonly id = TELEGRAM_CHANNEL_ID;
  private readonly bot: Bot;
  private readonly pairing: TelegramPairing;
  private readonly logger: Logger;
  private readonly drafts = new Map<string, ActiveDraft>();

  constructor({ token, db, logger }: TelegramChannelConfig) {
    runMigrations(db, 'channels.telegram', telegramMigrations);
    this.bot = new Bot(token);
    this.bot.api.config.use(autoRetry());
    this.pairing = new TelegramPairing(db);
    this.logger = logger;
  }

  async start(onEvent: InboundHandler): Promise<void> {
    await this.bot.init();
    const me = this.bot.botInfo;
    if (!me.has_topics_enabled) {
      this.logger.warn(
        'Threaded mode is off for this bot in BotFather: only the General thread will work.',
      );
    }
    const code = this.pairing.pendingCode();
    if (code) {
      this.logger.info(`Not paired yet. Send this message to @${me.username}: /start ${code}`);
    }

    this.bot.on('message', (ctx) => this.receive(ctx.message, onEvent));
    this.bot.catch((error) =>
      this.logger.error('Update handling failed', { error: describe(error.error) }),
    );

    await new Promise<void>((resolve, reject) => {
      let started = false;
      this.bot
        .start({
          // Messages sent while the Harness was down are kept by Telegram for 24 h: answer them.
          drop_pending_updates: false,
          allowed_updates: ['message'],
          onStart: () => {
            started = true;
            this.logger.info(`Polling as @${me.username}`);
            resolve();
          },
        })
        .catch((error: unknown) => {
          if (!started) reject(error);
          else this.logger.error('Polling stopped', { error: describe(error) });
        });
    });
  }

  async stop(): Promise<void> {
    for (const draft of this.drafts.values()) clearInterval(draft.timer);
    this.drafts.clear();
    await this.bot.stop();
  }

  async send(threadId: string | undefined, { markdown }: OutboundMessage): Promise<void> {
    const { chatId } = this.requireOwner();
    await this.showProgress(threadId, null);
    const thread = threadOptions(threadId);
    try {
      await this.bot.api.sendRichMessage(chatId, { markdown }, thread);
    } catch (error) {
      if (isThreadNotFound(error)) throw new ThreadNotFoundError(threadId);
      if (!shouldFallBackToPlainText(error)) throw error;
      this.logger.warn('Telegram rejected the rich message, falling back to plain text', {
        error: describe(error),
      });
      for (const chunk of splitText(markdown)) {
        try {
          await this.bot.api.sendMessage(chatId, chunk, thread);
        } catch (plainError) {
          if (isThreadNotFound(plainError)) throw new ThreadNotFoundError(threadId);
          throw plainError;
        }
      }
    }
  }

  async openThread(title: string): Promise<string> {
    const { chatId } = this.requireOwner();
    const topic = await this.bot.api.createForumTopic(chatId, title.slice(0, 128));
    return String(topic.message_thread_id);
  }

  async showProgress(threadId: string | undefined, status: string | null): Promise<void> {
    const key = threadId ?? '';
    const active = this.drafts.get(key);
    if (status === null) {
      if (active) clearInterval(active.timer);
      this.drafts.delete(key);
      return;
    }

    let draft = active;
    if (draft) {
      draft.status = status;
    } else {
      const created: ActiveDraft = {
        id: randomInt(1, 2 ** 31 - 1),
        status,
        timer: setInterval(() => void this.pushDraft(threadId, created), DRAFT_REFRESH_MS),
      };
      created.timer.unref();
      this.drafts.set(key, created);
      draft = created;
    }
    await this.pushDraft(threadId, draft);
  }

  async setCommands(commands: readonly CommandInfo[]): Promise<void> {
    await this.bot.api.setMyCommands(
      commands.map(({ name, description }) => ({ command: name, description })),
    );
  }

  private receive(message: Message, onEvent: InboundHandler): void {
    if (message.chat.type !== 'private' || !message.from) return;

    const owner = this.pairing.owner();
    if (!owner) {
      void this.tryPairing(message);
      return;
    }
    // Everyone but the Owner is ignored without an answer.
    if (message.from.id !== owner.userId) return;

    const event = toInboundEvent(message);
    if (event) onEvent(event);
  }

  private async tryPairing(message: Message): Promise<void> {
    const event = toInboundEvent(message);
    if (event?.type !== 'command' || event.name !== 'start' || !message.from) return;
    if (!this.pairing.pair(event.args, { userId: message.from.id, chatId: message.chat.id }))
      return;

    this.logger.info('Paired with the Owner', { userId: message.from.id });
    await this.bot.api.sendMessage(
      message.chat.id,
      '✅ Abbinamento completato: da ora rispondo solo a te. Scrivi /help per vedere cosa posso fare.',
    );
  }

  private async pushDraft(threadId: string | undefined, draft: ActiveDraft): Promise<void> {
    const owner = this.pairing.owner();
    if (!owner) return;
    try {
      await this.bot.api.sendMessageDraft(
        owner.chatId,
        draft.id,
        draft.status,
        threadOptions(threadId),
      );
    } catch (error) {
      this.logger.warn('Could not show progress', { error: describe(error) });
    }
  }

  private requireOwner() {
    const owner = this.pairing.owner();
    if (!owner) throw new Error('Telegram is not paired with the Owner yet.');
    return owner;
  }
}

function threadOptions(threadId: string | undefined) {
  return threadId === undefined ? {} : { message_thread_id: Number(threadId) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
