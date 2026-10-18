import {
  type Channel,
  type CommandInfo,
  type InboundEvent,
  type InboundHandler,
  type MessageAction,
  type OutboundMessage,
  ThreadNotFoundError,
} from './domain/channel.ts';

/**
 * Channel double for tests: records what the Harness sends and can simulate deleted threads.
 * A message's id is its position in `sent`, starting at 1.
 */
export class FakeChannel implements Channel {
  readonly id = 'fake';
  readonly sent: {
    threadId: string | undefined;
    markdown: string;
    actions?: readonly MessageAction[];
  }[] = [];
  readonly edited: { messageId: string; markdown: string; actions?: readonly MessageAction[] }[] =
    [];
  readonly progress: { threadId: string | undefined; status: string | null }[] = [];
  readonly opened: string[] = [];
  readonly renamed: { threadId: string; title: string }[] = [];
  /** Threads the Owner deleted: sending there throws ThreadNotFoundError. */
  readonly deletedThreads = new Set<string>();
  commands: readonly CommandInfo[] = [];
  private onEvent: InboundHandler | undefined;
  private nextThreadId = 100;

  async start(onEvent: InboundHandler): Promise<void> {
    this.onEvent = onEvent;
  }

  async stop(): Promise<void> {
    this.onEvent = undefined;
  }

  async send(
    threadId: string | undefined,
    { markdown, actions }: OutboundMessage,
  ): Promise<string> {
    if (threadId !== undefined && this.deletedThreads.has(threadId)) {
      throw new ThreadNotFoundError(threadId);
    }
    this.sent.push({ threadId, markdown, ...(actions?.length && { actions }) });
    return String(this.sent.length);
  }

  async editMessage(messageId: string, { markdown, actions }: OutboundMessage): Promise<void> {
    this.edited.push({ messageId, markdown, ...(actions?.length && { actions }) });
  }

  async openThread(title: string): Promise<string> {
    this.opened.push(title);
    return String(this.nextThreadId++);
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    if (this.deletedThreads.has(threadId)) throw new ThreadNotFoundError(threadId);
    this.renamed.push({ threadId, title });
  }

  async showProgress(threadId: string | undefined, status: string | null): Promise<void> {
    this.progress.push({ threadId, status });
  }

  async setCommands(commands: readonly CommandInfo[]): Promise<void> {
    this.commands = commands;
  }

  /** Simulates the Owner sending something. */
  receive(event: InboundEvent): void {
    this.onEvent?.(event);
  }

  /** Simulates the Owner pressing a button under the message sent with id `messageId`. */
  press(actionId: string, messageId: string): void {
    const threadId = this.sent[Number(messageId) - 1]?.threadId;
    this.receive({
      type: 'action',
      actionId,
      messageId,
      receivedAt: new Date(),
      ...(threadId !== undefined && { threadId }),
    });
  }
}
