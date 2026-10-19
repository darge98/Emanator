import { defineTool, type ToolDefinition } from '@emanator/engine';
import { z } from 'zod';

/** What opening a Conversation needs, provided by the Conversations feature. */
export interface ConversationOpener {
  openAgentTopic(title: string, markdown: string): Promise<{ name: string; title: string }>;
}

/** The conversations Faculty: the Agent opens a topic of its own to talk about something. */
export function conversationTools(conversations: ConversationOpener): ToolDefinition[] {
  return [
    defineTool({
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
        return { text: `Opened the topic "${topic.title}" (${topic.name}) and sent the message.` };
      },
    }),
  ];
}
