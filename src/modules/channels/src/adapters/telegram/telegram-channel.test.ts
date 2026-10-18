import { createTestDatabase } from '@emanator/shared/server';
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('TelegramChannel pairing', () => {
  it('keeps the owner paired and handles later messages when the confirmation send fails', async () => {
    const fixture = await createTestDatabase();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const channel = new TelegramChannel({ token: 'test-token', db: fixture.db, logger });
    await channel.init();
    const bot = (
      channel as unknown as {
        bot: { api: { sendMessage: (...args: unknown[]) => Promise<unknown> } };
      }
    ).bot;
    const sendMessage = vi
      .spyOn(bot.api, 'sendMessage')
      .mockRejectedValue(new Error('Telegram forbidden: bot was blocked'));
    const pairing = (
      channel as unknown as {
        pairing: { pendingCode(): string | undefined; owner(): Promise<unknown> };
      }
    ).pairing;
    const code = pairing.pendingCode();

    expect(code).toBeDefined();
    await (
      channel as unknown as { receive(message: Message, onEvent: (event: unknown) => void): void }
    ).receive(command(`/start ${code}`, 100), vi.fn());
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

    expect(await pairing.owner()).toEqual({ userId: 100, chatId: 100 });
    expect(logger.error).toHaveBeenCalledWith('Could not send Telegram pairing confirmation', {
      error: 'Telegram forbidden: bot was blocked',
    });

    const onEvent = vi.fn();
    (
      channel as unknown as { receive(message: Message, onEvent: (event: unknown) => void): void }
    ).receive({ ...command('hello', 100), entities: [] }, onEvent);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalled());
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message', text: 'hello' }),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await fixture.close();
  });
});
