import { defineTool } from '@emanator/engine';
import { z } from 'zod';
import type { Faculty, HarnessFacultyTool } from '../domain/faculty.ts';

/** What opening a Conversation needs, provided by the Conversations feature. */
export interface ConversationOpener {
  openAgentTopic(title: string, markdown: string): Promise<{ name: string; title: string }>;
}

/** Puts replies as buttons under the turn's answer; absent where nobody can press them. */
export type ReplySuggester = (replies: readonly string[]) => void;

/** A button carries its reply in Telegram's 64 bytes of data, behind a short prefix. */
const MAX_REPLY_BYTES = 60;

/** The Agent opens a topic of its own to talk about something, and suggests replies. */
export function conversationsFaculty(
  conversations: ConversationOpener,
  suggestReplies?: ReplySuggester,
): Faculty {
  return {
    kind: 'faculty',
    name: 'conversations',
    title: 'Conversations',
    description: 'New Telegram topics opened by the Agent, and replies offered as buttons.',
    tools: [
      openConversationTool(conversations),
      ...(suggestReplies ? [suggestRepliesTool(suggestReplies)] : []),
    ],
  };
}

function suggestRepliesTool(suggestReplies: ReplySuggester): HarnessFacultyTool {
  return {
    title: 'Suggest replies',
    defaultPolicy: 'allow',
    ...defineTool({
      name: 'suggest_replies',
      description:
        "Call it whenever your answer asks the Owner a single question with a few short likely answers (yes/no, or two to four choices), before you write the answer: the replies become buttons under it, and a tap sends that text back to you as the Owner's message. Not for open questions, nor when you ask more than one, since a tap answers only one. The Owner can still write anything else. A later call replaces the earlier one.",
      input: {
        replies: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(30)
              .refine((reply) => Buffer.byteLength(reply) <= MAX_REPLY_BYTES, 'Too long'),
          )
          .min(2)
          .max(4)
          .refine((replies) => new Set(replies).size === replies.length, 'Replies must differ')
          .describe('The replies, in the Owner\'s language, e.g. ["Sì", "No"]'),
      },
      hints: { readOnly: true },
      run: async ({ replies }) => {
        suggestReplies(replies);
        return { text: 'The replies will appear as buttons under your answer.' };
      },
    }),
  };
}

function openConversationTool(conversations: ConversationOpener): HarnessFacultyTool {
  return {
    title: 'Open a conversation',
    defaultPolicy: 'allow',
    ...defineTool({
      name: 'open_conversation',
      description:
        'Opens a new Telegram topic with the Owner, with its own context, and sends the first message there. Use it to start a separate subject, not to reply.',
      input: {
        title: z.string().trim().min(1).max(128).describe('Short title of the topic'),
        message: z.string().trim().min(1).describe('First message, in Markdown'),
      },
      hints: { readOnly: false },
      run: async ({ title, message }) => {
        const topic = await conversations.openAgentTopic(title, message);
        return {
          text: `Opened the topic "${topic.title}" (${topic.name}) and sent the message.`,
        };
      },
    }),
  };
}
