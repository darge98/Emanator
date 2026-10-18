import { openDatabase } from '@emanator/shared/server';
import type { Message } from 'grammy/types';
import { describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from './telegram-channel.ts';

function command(text: string, userId: number): Message {
  return {
    message_id: 1,
    date: 1,
    chat: { id: userId, type: 'private' },
    from: { id: userId, is_bot: false, first_name: 'Owner' },
    text,
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  } as Message;
}

describe('TelegramChannel pairing', () => {
  it('keeps the owner paired and handles later messages when the confirmation send fails', async () => {
    const db = openDatabase(':memory:');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const channel = new TelegramChannel({ token: 'test-token', db, logger });
    const bot = (
      channel as unknown as {
        bot: { api: { sendMessage: (...args: unknown[]) => Promise<unknown> } };
      }
    ).bot;
    const sendMessage = vi
      .spyOn(bot.api, 'sendMessage')
      .mockRejectedValue(new Error('Telegram forbidden: bot was blocked'));
    const pairing = (
      channel as unknown as { pairing: { pendingCode(): string | undefined; owner(): unknown } }
    ).pairing;
    const code = pairing.pendingCode();

    expect(code).toBeDefined();
    await (
      channel as unknown as { receive(message: Message, onEvent: (event: unknown) => void): void }
    ).receive(command(`/start ${code}`, 100), vi.fn());
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

    expect(pairing.owner()).toEqual({ userId: 100, chatId: 100 });
    expect(logger.error).toHaveBeenCalledWith('Could not send Telegram pairing confirmation', {
      error: 'Telegram forbidden: bot was blocked',
    });

    const onEvent = vi.fn();
    (
      channel as unknown as { receive(message: Message, onEvent: (event: unknown) => void): void }
    ).receive({ ...command('hello', 100), entities: [] }, onEvent);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message', text: 'hello' }),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    db.close();
  });
});
