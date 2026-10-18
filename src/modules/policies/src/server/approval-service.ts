import type { Channel, InboundAction } from '@emanator/channels';
import { errorMessage, type Logger } from '@emanator/shared/server';
import type { Approval, ApprovalStatus } from '../domain/approval.ts';
import * as say from './messages.ts';
import type { PolicyStore } from './policy-store.ts';

export interface ApprovalServiceDeps {
  channel: Pick<Channel, 'send' | 'editMessage'>;
  store: Pick<
    PolicyStore,
    | 'createApproval'
    | 'getApproval'
    | 'addApprovalMessage'
    | 'decideApproval'
    | 'expirePendingApprovals'
  >;
  logger: Logger;
  /** Runs `run` after `ms` and returns a function that cancels it. Replaceable in tests. */
  schedule?: (ms: number, run: () => void) => () => void;
}

export interface ApprovalRequest {
  tool: string;
  input: Record<string, unknown>;
  /** Where to ask: the thread of the turn that needs the Tool; undefined for General. */
  threadId: string | undefined;
  /** Aborted when the turn ends while waiting: the request then expires. */
  signal: AbortSignal;
}

/** An unanswered request is repeated once after this long… */
const REMIND_AFTER_MS = 15 * 60_000;
/** …and expires this long after the reminder. */
const EXPIRE_AFTER_REMINDER_MS = 15 * 60_000;

/** Button ids carry the Approval id, so a press is matched without trusting its thread. */
const BUTTON_ID = /^ap:([0-9a-f-]{36}):([yn])$/;

function defaultSchedule(ms: number, run: () => void): () => void {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

interface Waiting {
  resolve: (status: Exclude<ApprovalStatus, 'pending'>) => void;
  cancelTimers: (() => void)[];
  decided: boolean;
}

/**
 * Asks the Owner before a Tool with an *ask* Policy runs, with Yes/No buttons in the
 * turn's thread. The turn waits for the answer; no answer counts as a denial.
 */
export class ApprovalService {
  private readonly waiting = new Map<string, Waiting>();
  private readonly schedule: (ms: number, run: () => void) => () => void;
  private stopped = false;

  constructor(private readonly deps: ApprovalServiceDeps) {
    this.schedule = deps.schedule ?? defaultSchedule;
  }

  /** Expires what the last process left pending: those turns ended with it. */
  async init(): Promise<void> {
    const expired = await this.deps.store.expirePendingApprovals();
    await Promise.all(expired.map((approval) => this.close(approval)));
  }

  /** Resolves with the decision, never `pending`. */
  async request({
    tool,
    input,
    threadId,
    signal,
  }: ApprovalRequest): Promise<Exclude<ApprovalStatus, 'pending'>> {
    if (this.stopped || signal.aborted) return 'expired';
    const approval = await this.deps.store.createApproval(tool, input, threadId);
    const { id } = approval;
    const decided = new Promise<Exclude<ApprovalStatus, 'pending'>>((resolve) => {
      this.waiting.set(id, { resolve, cancelTimers: [], decided: false });
    });
    const expire = () => void this.settle(id, 'expired');
    signal.addEventListener('abort', expire, { once: true });
    try {
      // stop() may have run while the request was being saved, before it could see it.
      if (this.stopped) expire();
      else if (await this.ask(approval, false)) {
        const waiting = this.waiting.get(id);
        if (!waiting?.decided) {
          waiting?.cancelTimers.push(
            this.schedule(REMIND_AFTER_MS, () => void this.ask(approval, true)),
            this.schedule(REMIND_AFTER_MS + EXPIRE_AFTER_REMINDER_MS, expire),
          );
        }
      } else {
        // The Owner can't be asked, so the answer is no.
        expire();
      }
      return await decided;
    } finally {
      signal.removeEventListener('abort', expire);
      this.waiting.delete(id);
    }
  }

  /** Handles a button press. Never rejects: presses arrive outside any queue. */
  async answer(press: InboundAction): Promise<void> {
    const match = BUTTON_ID.exec(press.actionId);
    if (!match?.[1]) return;
    const id = match[1];
    try {
      if (await this.settle(id, match[2] === 'y' ? 'approved' : 'denied')) return;
      // Already decided, or unknown, e.g. pressed after a restart: show how it ended.
      const approval = await this.deps.store.getApproval(id);
      await this.deps.channel.editMessage(press.messageId, {
        markdown: approval ? say.approvalOutcome(approval) : say.approvalGone,
      });
    } catch (error) {
      this.deps.logger.error('Could not handle an Approval answer', {
        approval: id,
        error: errorMessage(error),
      });
    }
  }

  /** Expires every request still waiting, so their turns can end. */
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.waiting.keys()].map((id) => this.settle(id, 'expired')));
  }

  /** Sends the request with its buttons; false when it could not be sent. */
  private async ask(approval: Approval, reminder: boolean): Promise<boolean> {
    const { id } = approval;
    try {
      const messageId = await this.deps.channel.send(approval.threadId, {
        markdown: say.approvalRequest(approval, reminder),
        actions: [
          { id: `ap:${id}:y`, label: say.APPROVE_LABEL },
          { id: `ap:${id}:n`, label: say.DENY_LABEL },
        ],
      });
      await this.deps.store.addApprovalMessage(id, messageId);
      // Decided while this message was on its way: its buttons must go too. The database
      // decides, since the decision may have read the message ids before this one was added.
      const current = await this.deps.store.getApproval(id);
      if (current && current.status !== 'pending') await this.close(current);
      return true;
    } catch (error) {
      this.deps.logger.error('Could not ask for an Approval', {
        approval: id,
        tool: approval.tool,
        error: errorMessage(error),
      });
      return false;
    }
  }

  /**
   * Records the decision and wakes the waiting turn. Returns false when the Approval was
   * already decided or is unknown. Never rejects.
   */
  private async settle(id: string, status: Exclude<ApprovalStatus, 'pending'>): Promise<boolean> {
    let approval: Approval | undefined;
    try {
      approval = await this.deps.store.decideApproval(id, status);
    } catch (error) {
      this.deps.logger.error('Could not record an Approval decision', {
        approval: id,
        error: errorMessage(error),
      });
      // A turn must not hang on the database: anything but a yes still ends the wait.
      if (status !== 'approved') this.wake(id, status);
      return false;
    }
    if (!approval) return false;
    this.deps.logger.info('Approval decided', { approval: id, tool: approval.tool, status });
    this.wake(id, status);
    await this.close(approval);
    return true;
  }

  private wake(id: string, status: Exclude<ApprovalStatus, 'pending'>): void {
    const waiting = this.waiting.get(id);
    if (!waiting || waiting.decided) return;
    waiting.decided = true;
    for (const cancel of waiting.cancelTimers) cancel();
    waiting.resolve(status);
  }

  /** Shows the outcome in every message that asked and removes their buttons. */
  private async close(approval: Approval): Promise<void> {
    const markdown = say.approvalOutcome(approval);
    for (const messageId of approval.messageIds) {
      try {
        await this.deps.channel.editMessage(messageId, { markdown });
      } catch (error) {
        this.deps.logger.warn('Could not update an Approval message', {
          approval: approval.id,
          error: errorMessage(error),
        });
      }
    }
  }
}
