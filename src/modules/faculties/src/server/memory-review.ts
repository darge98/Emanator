import { randomBytes } from 'node:crypto';
import type { Channel, InboundAction, MessageAction, OutboundMessage } from '@emanator/channels';
import { MemoryError, type MemoryService } from '@emanator/memory/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import * as say from './messages.ts';

/** An inferred Fact a turn of the Owner's wrote, for them to confirm or forget. */
export interface NotedFact {
  page: string;
  id: string;
  text: string;
}

export interface MemoryReviewDeps {
  channel: Pick<Channel, 'setActions'>;
  memory: Pick<MemoryService, 'confirm' | 'forget'>;
  logger: Logger;
}

const PREFIX = 'mr:';
/** Reviews kept for their buttons; an older one asks the Owner to use the dashboard. */
const KEPT = 200;
const BY_TELEGRAM = 'da Telegram';

/**
 * After a tainted turn of the Owner's, the Facts it noted as inferred, with one button to
 * confirm them all and one to forget them (ADR 0009). The Harness writes the list from what
 * was saved, so nothing the model read can change what a press confirms. Reviews live in
 * memory: after a restart their buttons point to the dashboard.
 */
export class MemoryReview {
  private readonly pending = new Map<string, NotedFact[]>();

  constructor(private readonly deps: MemoryReviewDeps) {}

  /** The message listing `facts` with its buttons; undefined when there is nothing to review. */
  message(facts: readonly NotedFact[]): OutboundMessage | undefined {
    if (facts.length === 0) return undefined;
    const token = randomBytes(6).toString('base64url');
    this.pending.set(token, [...facts]);
    for (const old of this.pending.keys()) {
      if (this.pending.size <= KEPT) break;
      this.pending.delete(old);
    }
    return {
      markdown: say.reviewNoted(facts),
      actions: [
        { id: `${PREFIX}${token}:y`, label: say.REVIEW_CONFIRM },
        { id: `${PREFIX}${token}:n`, label: say.REVIEW_FORGET },
      ],
    };
  }

  handles(press: InboundAction): boolean {
    return press.actionId.startsWith(PREFIX);
  }

  /** Confirms or forgets the Facts of the review pressed; a second press finds it gone. */
  async answer(press: InboundAction): Promise<void> {
    const [token = '', choice] = press.actionId.slice(PREFIX.length).split(':');
    if (!token) return;
    const facts = this.pending.get(token);
    this.pending.delete(token);
    if (!facts) return this.mark(press, say.REVIEW_EXPIRED);
    const confirm = choice === 'y';
    for (const { page, id } of facts) {
      try {
        if (confirm) await this.deps.memory.confirm(page, id, BY_TELEGRAM);
        else await this.deps.memory.forget(page, id, BY_TELEGRAM);
      } catch (error) {
        // Already gone, e.g. forgotten since: nothing left to do for it.
        if (error instanceof MemoryError) continue;
        this.deps.logger.error('Could not apply a Memory review', { error: errorMessage(error) });
      }
    }
    await this.mark(press, confirm ? say.REVIEW_CONFIRMED : say.REVIEW_FORGOTTEN);
  }

  /** What stays under the message: the outcome, which does nothing. */
  private async mark(press: InboundAction, label: string): Promise<void> {
    const done: MessageAction = { id: PREFIX, label };
    try {
      await this.deps.channel.setActions(press.messageId, [done]);
    } catch (error) {
      this.deps.logger.warn('Could not update a Memory review', { error: errorMessage(error) });
    }
  }
}
