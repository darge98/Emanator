import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboundAction } from '@emanator/channels';
import { FakeChannel } from '@emanator/channels/testing';
import { MemoryService } from '@emanator/memory/server';
import { silentLogger } from '@emanator/shared/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryReview, type NotedFact } from './memory-review.ts';

let dir: string;
let memory: MemoryService;
let channel: FakeChannel;
let review: MemoryReview;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emanator-memory-review-'));
  memory = new MemoryService({ dir, timeZone: 'Europe/Rome', logger: silentLogger });
  await memory.init();
  channel = new FakeChannel();
  review = new MemoryReview({ channel, memory, logger: silentLogger });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function inferred(text: string): Promise<NotedFact> {
  const { page, fact } = await memory.remember({
    page: 'Marco Rossi',
    kind: 'persone',
    fact: text,
    factKind: 'fact',
    trust: 'inferred',
    source: 'mail di Marco',
    mayAddKind: false,
  });
  return { page: page.title, id: fact.id, text: fact.text };
}

const press = (actionId: string): InboundAction => ({
  type: 'action',
  actionId,
  messageId: '7',
  receivedAt: new Date(),
});

const trusts = async () => (await memory.page('Marco Rossi'))?.facts.map(({ trust }) => trust);

describe('MemoryReview', () => {
  it('says nothing when the turn noted nothing', () => {
    expect(review.message([])).toBeUndefined();
  });

  it('lists the noted Facts, and one press confirms them all', async () => {
    const message = review.message([await inferred('Collega.'), await inferred('Ha due figli.')]);
    expect(message?.markdown).toContain('- **Marco Rossi**: Collega.\n- **Marco Rossi**: Ha due');
    const [yes] = message?.actions ?? [];

    await review.answer(press(yes?.id ?? ''));

    expect(await trusts()).toEqual(['confirmed', 'confirmed']);
    expect(channel.actionsSet).toEqual([
      { messageId: '7', actions: [{ id: 'mr:', label: '✓ Confermati' }] },
    ]);
  });

  it('forgets them all, and a second press finds the review gone', async () => {
    await inferred('Collega.');
    const [, no] = review.message([await inferred('Ha due figli.')])?.actions ?? [];

    await review.answer(press(no?.id ?? ''));
    await review.answer(press(no?.id ?? ''));

    expect(await trusts()).toEqual(['inferred']);
    expect(channel.actionsSet.map(({ actions }) => actions[0]?.label)).toEqual([
      '✕ Dimenticati',
      'Scaduto: usa la dashboard',
    ]);
  });

  it('skips Facts already gone, and ignores the outcome button', async () => {
    const gone = await inferred('Collega.');
    const kept = await inferred('Ha due figli.');
    const [yes] = review.message([gone, kept])?.actions ?? [];
    await memory.forget('Marco Rossi', gone.id);

    await review.answer(press(yes?.id ?? ''));
    await review.answer(press('mr:'));

    expect(await trusts()).toEqual(['confirmed']);
    expect(channel.actionsSet).toHaveLength(1);
  });
});
