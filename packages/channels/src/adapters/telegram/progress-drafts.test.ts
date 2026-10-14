import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressDrafts } from './progress-drafts.ts';

interface Push {
  threadId: string | undefined;
  draftId: number;
  text: string;
}

function recorder() {
  const pushes: Push[] = [];
  let hold: Promise<void> | undefined;
  const push = vi.fn(async (threadId: string | undefined, draftId: number, text: string) => {
    pushes.push({ threadId, draftId, text });
    await hold;
  });
  /** Makes the next pushes hang until the returned function is called. */
  const holdPushes = () => {
    let release = () => {};
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      hold = undefined;
      release();
    };
  };
  return { pushes, push, holdPushes };
}

describe('ProgressDrafts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a draft alive with the same id until it is cleared', async () => {
    const { pushes, push } = recorder();
    const drafts = new ProgressDrafts(push, 20_000);

    await drafts.show('42', '');
    await drafts.show('42', '🔧 get_time…');
    await vi.advanceTimersByTimeAsync(20_000);
    await drafts.show('42', null);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pushes.map((p) => p.text)).toEqual(['', '🔧 get_time…', '🔧 get_time…']);
    expect(new Set(pushes.map((p) => p.draftId)).size).toBe(1);
    expect(pushes.every((p) => p.threadId === '42')).toBe(true);
  });

  it('waits for a refresh already on its way before reporting the draft cleared', async () => {
    const { pushes, push, holdPushes } = recorder();
    const drafts = new ProgressDrafts(push, 20_000);
    await drafts.show(undefined, '');

    const release = holdPushes();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushes).toHaveLength(2);

    let cleared = false;
    const clearing = drafts.show(undefined, null).then(() => {
      cleared = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(cleared).toBe(false);

    release();
    await clearing;
    expect(cleared).toBe(true);
  });

  it('keeps separate drafts per thread', async () => {
    const { pushes, push } = recorder();
    const drafts = new ProgressDrafts(push, 20_000);

    await drafts.show(undefined, 'generale');
    await drafts.show('42', 'topic');

    expect(pushes[0]?.draftId).not.toBe(pushes[1]?.draftId);
  });

  it('survives a push that fails', async () => {
    const drafts = new ProgressDrafts(async () => {
      throw new Error('network down');
    });

    await expect(drafts.show('42', '')).resolves.toBeUndefined();
    await expect(drafts.show('42', null)).resolves.toBeUndefined();
  });
});
