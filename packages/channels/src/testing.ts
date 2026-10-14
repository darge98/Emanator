import {
  type Channel,
  type CommandInfo,
  type InboundEvent,
  type InboundHandler,
  type OutboundMessage,
  ThreadNotFoundError,
} from './domain/channel.ts';

/** Channel double for tests: records what the Harness sends and can simulate deleted threads. */
export class FakeChannel implements Channel {
  readonly id = 'fake';
  readonly sent: { threadId: string | undefined; markdown: string }[] = [];
  readonly progress: { threadId: string | undefined; status: string | null }[] = [];
  readonly opened: string[] = [];
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

  async send(threadId: string | undefined, { markdown }: OutboundMessage): Promise<void> {
    if (threadId !== undefined && this.deletedThreads.has(threadId)) {
      throw new ThreadNotFoundError(threadId);
    }
    this.sent.push({ threadId, markdown });
  }

  async openThread(title: string): Promise<string> {
    this.opened.push(title);
    return String(this.nextThreadId++);
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
}
