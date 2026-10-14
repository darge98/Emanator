/**
 * A medium the Agent and the Owner exchange messages through. A Channel only
 * moves messages: it knows nothing about Conversations or the Engine.
 *
 * Messages live in threads. `threadId` is undefined for the Channel's General thread.
 */
export interface Channel {
  readonly id: string;
  /** Starts receiving; inbound events are delivered to `onEvent` from the Paired Owner only. */
  start(onEvent: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  /** Throws `ThreadNotFoundError` when the thread no longer exists. */
  send(threadId: string | undefined, message: OutboundMessage): Promise<void>;
  /** Opens a new thread (e.g. a Telegram topic) and returns its id. */
  openThread(title: string): Promise<string>;
  /**
   * Shows a transient status while the Agent works (`''` for a generic "thinking" state);
   * `null` stops showing it. Best-effort: failures are swallowed.
   */
  showProgress(threadId: string | undefined, status: string | null): Promise<void>;
  /** Advertises the commands the Owner can use, where the Channel has a menu for them. */
  setCommands(commands: readonly CommandInfo[]): Promise<void>;
}

export interface CommandInfo {
  /** Without the slash, e.g. `new`. */
  name: string;
  description: string;
}

export type InboundHandler = (event: InboundEvent) => void;

export type InboundEvent = InboundMessage | InboundCommand | InboundUnsupported;

interface InboundBase {
  threadId?: string;
  receivedAt: Date;
}

export interface InboundMessage extends InboundBase {
  type: 'message';
  text: string;
}

/** A command such as `/new` or `/topic Trip to Japan`; `name` has no slash. */
export interface InboundCommand extends InboundBase {
  type: 'command';
  name: string;
  args: string;
}

/** Content the Harness can't handle yet, such as voice notes or photos. */
export interface InboundUnsupported extends InboundBase {
  type: 'unsupported';
  kind: string;
}

export interface OutboundMessage {
  /** Markdown; the Channel renders it as richly as it can. */
  markdown: string;
}

export class ThreadNotFoundError extends Error {
  constructor(readonly threadId: string | undefined) {
    super(`Thread ${threadId ?? 'General'} no longer exists.`);
    this.name = 'ThreadNotFoundError';
  }
}
