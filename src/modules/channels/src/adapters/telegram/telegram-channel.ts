import { type Database, errorMessage, type Logger, runMigrations } from '@emanator/shared/server';
import { autoRetry } from '@grammyjs/auto-retry';
import { Bot } from 'grammy';
import type { CallbackQuery, Message } from 'grammy/types';
import {
  type Channel,
  type CommandInfo,
  type InboundHandler,
  type MessageAction,
  type OutboundMessage,
  ThreadNotFoundError,
} from '../../domain/channel.ts';
import { toInboundAction, toInboundEvent } from './inbound.ts';
import { telegramMigrations } from './migrations.ts';
import { TelegramPairing } from './pairing.ts';
import { ProgressDrafts } from './progress-drafts.ts';
import {
  isMessageGone,
  isMessageNotModified,
  isThreadNotFound,
  isTopicNotModified,
  shouldFallBackToPlainText,
} from './send-errors.ts';
import { splitText } from './split-text.ts';

export const TELEGRAM_CHANNEL_ID = 'telegram';

export interface TelegramChannelConfig {
  token: string;
  db: Database;
  logger: Logger;
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
  private readonly db: Database;
  private readonly logger: Logger;
  private readonly progress = new ProgressDrafts((threadId, draftId, text) =>
    this.sendDraft(threadId, draftId, text),
  );

  constructor({ token, db, logger }: TelegramChannelConfig) {
    this.bot = new Bot(token);
    this.bot.api.config.use(autoRetry());
    this.pairing = new TelegramPairing(db);
    this.db = db;
    this.logger = logger;
  }

  async init(): Promise<void> {
    await runMigrations(this.db, 'channels.telegram', telegramMigrations);
    await this.pairing.init();
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
    this.bot.on('callback_query:data', (ctx) => this.press(ctx.callbackQuery, onEvent));
    this.bot.catch((error) =>
      this.logger.error('Update handling failed', { error: errorMessage(error.error) }),
    );

    await new Promise<void>((resolve, reject) => {
      let started = false;
      this.bot
        .start({
          // Messages sent while the Harness was down are kept by Telegram for 24 h: answer them.
          drop_pending_updates: false,
          allowed_updates: ['message', 'callback_query'],
          onStart: () => {
            started = true;
            this.logger.info(`Polling as @${me.username}`);
            resolve();
          },
        })
        .catch((error: unknown) => {
          if (!started) reject(error);
          else this.logger.error('Polling stopped', { error: errorMessage(error) });
        });
    });
  }

  async stop(): Promise<void> {
    this.progress.clear();
    await this.bot.stop();
  }

  async send(threadId: string | undefined, message: OutboundMessage): Promise<string> {
    const { chatId } = await this.requireOwner();
    await this.showProgress(threadId, null);
    const thread = threadOptions(threadId);
    const markup = replyMarkup(message);
    try {
      const sent = await this.bot.api.sendRichMessage(
        chatId,
        { markdown: message.markdown },
        { ...thread, ...markup },
      );
      return String(sent.message_id);
    } catch (error) {
      if (isThreadNotFound(error)) throw new ThreadNotFoundError(threadId);
      if (!shouldFallBackToPlainText(error)) throw error;
      this.logger.warn('Telegram rejected the rich message, falling back to plain text', {
        error: errorMessage(error),
      });
      const chunks = splitText(message.markdown);
      let lastId = '';
      for (const [index, chunk] of chunks.entries()) {
        // Buttons go under the last chunk, where the message ends.
        const last = index === chunks.length - 1;
        try {
          const sent = await this.bot.api.sendMessage(chatId, chunk, {
            ...thread,
            ...(last && markup),
          });
          lastId = String(sent.message_id);
        } catch (plainError) {
          if (isThreadNotFound(plainError)) throw new ThreadNotFoundError(threadId);
          throw plainError;
        }
      }
      return lastId;
    }
  }

  async editMessage(messageId: string, message: OutboundMessage): Promise<void> {
    const { chatId } = await this.requireOwner();
    // Without a reply_markup Telegram removes the buttons, which is what no actions means.
    const markup = replyMarkup(message);
    try {
      await this.bot.api.editMessageText(
        chatId,
        Number(messageId),
        { markdown: message.markdown },
        markup,
      );
    } catch (error) {
      // Nothing left to change: the edit already applied, or the message is gone.
      if (isMessageNotModified(error) || isMessageGone(error)) return;
      if (!shouldFallBackToPlainText(error)) throw error;
      const [first = ''] = splitText(message.markdown);
      await this.bot.api.editMessageText(chatId, Number(messageId), first, markup);
    }
  }

  async setActions(messageId: string, actions: readonly MessageAction[]): Promise<void> {
    const { chatId } = await this.requireOwner();
    try {
      await this.bot.api.editMessageReplyMarkup(
        chatId,
        Number(messageId),
        replyMarkup({ actions }),
      );
    } catch (error) {
      if (isMessageNotModified(error) || isMessageGone(error)) return;
      throw error;
    }
  }

  async openThread(title: string): Promise<string> {
    const { chatId } = await this.requireOwner();
    const topic = await this.bot.api.createForumTopic(chatId, title.slice(0, 128));
    return String(topic.message_thread_id);
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const { chatId } = await this.requireOwner();
    try {
      await this.bot.api.editForumTopic(chatId, Number(threadId), { name: title.slice(0, 128) });
    } catch (error) {
      if (isThreadNotFound(error)) throw new ThreadNotFoundError(threadId);
      if (isTopicNotModified(error)) return;
      throw error;
    }
  }

  async showProgress(threadId: string | undefined, status: string | null): Promise<void> {
    await this.progress.show(threadId, status);
  }

  async setCommands(commands: readonly CommandInfo[]): Promise<void> {
    await this.bot.api.setMyCommands(
      commands.map(({ name, description }) => ({ command: name, description })),
    );
  }

  private async receive(message: Message, onEvent: InboundHandler): Promise<void> {
    if (message.chat.type !== 'private' || !message.from) return;

    const owner = await this.pairing.owner();
    if (!owner) {
      await this.tryPairing(message);
      return;
    }
    // Everyone but the Owner is ignored without an answer.
    if (message.from.id !== owner.userId) return;

    const event = toInboundEvent(message);
    if (event) onEvent(event);
  }

  private async press(query: CallbackQuery, onEvent: InboundHandler): Promise<void> {
    // Telegram keeps the button spinning until the press is answered, whoever pressed it.
    try {
      await this.bot.api.answerCallbackQuery(query.id);
    } catch (error) {
      this.logger.warn('Could not answer a button press', { error: errorMessage(error) });
    }
    const owner = await this.pairing.owner();
    if (!owner || query.from.id !== owner.userId) return;

    const event = toInboundAction(query, new Date());
    if (event) onEvent(event);
  }

  private async tryPairing(message: Message): Promise<void> {
    const event = toInboundEvent(message);
    if (event?.type !== 'command' || event.name !== 'start' || !message.from) return;
    if (
      !(await this.pairing.pair(event.args, { userId: message.from.id, chatId: message.chat.id }))
    )
      return;

    this.logger.info('Paired with the Owner', { userId: message.from.id });
    try {
      await this.bot.api.sendMessage(
        message.chat.id,
        '✅ Abbinamento completato: da ora rispondo solo a te. Scrivi /help per vedere cosa posso fare.',
      );
    } catch (error) {
      this.logger.error('Could not send Telegram pairing confirmation', {
        error: errorMessage(error),
      });
    }
  }

  private async sendDraft(
    threadId: string | undefined,
    draftId: number,
    text: string,
  ): Promise<void> {
    const owner = await this.pairing.owner();
    if (!owner) return;
    try {
      await this.bot.api.sendMessageDraft(owner.chatId, draftId, text, threadOptions(threadId));
    } catch (error) {
      this.logger.warn('Could not show progress', { error: errorMessage(error) });
    }
  }

  private async requireOwner() {
    const owner = await this.pairing.owner();
    if (!owner) throw new Error('Telegram is not paired with the Owner yet.');
    return owner;
  }
}

function replyMarkup({ actions }: Pick<OutboundMessage, 'actions'>) {
  if (!actions?.length) return {};
  return {
    reply_markup: {
      inline_keyboard: [actions.map(({ id, label }) => ({ text: label, callback_data: id }))],
    },
  };
}

function threadOptions(threadId: string | undefined) {
  return threadId === undefined ? {} : { message_thread_id: Number(threadId) };
}
