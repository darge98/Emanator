import type { Message } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { toInboundEvent } from './inbound.ts';

const DATE = 1_792_000_000;
const message = (fields: Record<string, unknown>) =>
  ({
    message_id: 1,
    date: DATE,
    chat: { id: 7, type: 'private' },
    ...fields,
  }) as unknown as Message;
const command = (text: string, length: number, fields: Record<string, unknown> = {}) =>
  message({ text, entities: [{ type: 'bot_command', offset: 0, length }], ...fields });

describe('toInboundEvent', () => {
  it('maps a text message in the General topic to a message without a thread', () => {
    expect(toInboundEvent(message({ text: 'Ciao' }))).toEqual({
      type: 'message',
      text: 'Ciao',
      receivedAt: new Date(DATE * 1000),
    });
  });

  it('keeps the topic as the thread id', () => {
    const event = toInboundEvent(
      message({ text: 'Ciao', is_topic_message: true, message_thread_id: 42 }),
    );

    expect(event).toMatchObject({ type: 'message', threadId: '42' });
  });

  it('ignores a thread id that does not belong to a topic', () => {
    const event = toInboundEvent(message({ text: 'Ciao', message_thread_id: 42 }));

    expect(event).not.toHaveProperty('threadId');
  });

  it('parses a command with arguments', () => {
    expect(toInboundEvent(command('/topic Viaggio in Giappone', 6))).toMatchObject({
      type: 'command',
      name: 'topic',
      args: 'Viaggio in Giappone',
    });
  });

  it('strips the bot mention and lowercases the command name', () => {
    expect(toInboundEvent(command('/NEW@emanator_bot', 17))).toMatchObject({
      type: 'command',
      name: 'new',
      args: '',
    });
  });

  it('treats a slash that is not a leading bot command as plain text', () => {
    const event = toInboundEvent(
      message({ text: 'usa /new', entities: [{ type: 'bot_command', offset: 4, length: 4 }] }),
    );

    expect(event).toMatchObject({ type: 'message', text: 'usa /new' });
  });

  it('reports content it cannot handle yet', () => {
    expect(toInboundEvent(message({ voice: { file_id: 'v', duration: 3 } }))).toMatchObject({
      type: 'unsupported',
      kind: 'voice',
    });
  });

  it('ignores service messages', () => {
    expect(toInboundEvent(message({ forum_topic_created: { name: 'Viaggio' } }))).toBeUndefined();
  });
});
