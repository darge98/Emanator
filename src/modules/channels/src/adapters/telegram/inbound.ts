import type { Message } from 'grammy/types';
import type { InboundEvent } from '../../domain/channel.ts';

// Content kinds the Owner may send that the Harness can't handle yet.
const UNSUPPORTED_KINDS = [
  'voice',
  'audio',
  'photo',
  'video',
  'video_note',
  'document',
  'sticker',
  'animation',
  'location',
  'venue',
  'contact',
  'poll',
] as const;

/**
 * Maps a Telegram message from the Owner to an inbound event. Returns undefined for
 * service messages (topic created, pinned message, …), which carry no content.
 */
export function toInboundEvent(message: Message): InboundEvent | undefined {
  const base = {
    receivedAt: new Date(message.date * 1000),
    // Messages in the General topic carry no thread id.
    ...(message.is_topic_message &&
      message.message_thread_id !== undefined && { threadId: String(message.message_thread_id) }),
  };

  if (message.text !== undefined) {
    const command = parseCommand(message);
    return command
      ? { type: 'command', ...base, ...command }
      : { type: 'message', ...base, text: message.text };
  }

  const kind = UNSUPPORTED_KINDS.find((key) => message[key] !== undefined);
  return kind ? { type: 'unsupported', ...base, kind } : undefined;
}

function parseCommand(message: Message): { name: string; args: string } | undefined {
  const text = message.text ?? '';
  const entity = message.entities?.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (!entity) return undefined;

  // "/topic@my_bot Trip to Japan" -> name "topic", args "Trip to Japan"
  const name = text.slice(1, entity.length).split('@')[0]?.toLowerCase() ?? '';
  return { name, args: text.slice(entity.length).trim() };
}
