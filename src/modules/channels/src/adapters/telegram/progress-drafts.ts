import { randomInt } from 'node:crypto';

// Telegram drops a draft after about 30 s, so a long turn has to refresh it.
export const DRAFT_REFRESH_MS = 20_000;

/** Sends or replaces a draft; must never reject (failures are the caller's to log). */
export type PushDraft = (
  threadId: string | undefined,
  draftId: number,
  text: string,
) => Promise<void>;

interface Draft {
  id: number;
  status: string;
  timer: NodeJS.Timeout;
  /** The last push sent to Telegram, possibly still awaiting its answer. */
  inFlight: Promise<void>;
  sending: boolean;
}

/**
 * The transient status shown in a thread while the Agent works, kept alive by refreshing it.
 * Clearing waits for a refresh that is already on its way, so it can never land after the
 * message that follows and bring the status back under the reply.
 */
export class ProgressDrafts {
  private readonly drafts = new Map<string, Draft>();

  constructor(
    private readonly push: PushDraft,
    private readonly refreshMs = DRAFT_REFRESH_MS,
  ) {}

  async show(threadId: string | undefined, status: string | null): Promise<void> {
    const key = threadId ?? '';
    const active = this.drafts.get(key);

    if (status === null) {
      if (!active) return;
      clearInterval(active.timer);
      this.drafts.delete(key);
      await active.inFlight;
      return;
    }

    const draft = active ?? this.start(key, threadId, status);
    draft.status = status;
    await this.send(threadId, draft);
  }

  /** Stops every refresh at once, e.g. on shutdown. */
  clear(): void {
    for (const draft of this.drafts.values()) clearInterval(draft.timer);
    this.drafts.clear();
  }

  private start(key: string, threadId: string | undefined, status: string): Draft {
    const draft: Draft = {
      // Reusing the same id makes Telegram animate the change instead of starting over.
      id: randomInt(1, 2 ** 31 - 1),
      status,
      timer: setInterval(() => void this.send(threadId, draft), this.refreshMs),
      inFlight: Promise.resolve(),
      sending: false,
    };
    draft.timer.unref();
    this.drafts.set(key, draft);
    return draft;
  }

  private send(threadId: string | undefined, draft: Draft): Promise<void> {
    if (draft.sending) return draft.inFlight;

    draft.sending = true;
    draft.inFlight = this.push(threadId, draft.id, draft.status)
      .catch(() => {})
      .finally(() => {
        draft.sending = false;
      });
    return draft.inFlight;
  }
}
