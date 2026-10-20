import { FakeChannel } from '@emanator/channels/testing';
import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalService } from './approval-service.ts';
import { PolicyStore } from './policy-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

const MINUTE = 60_000;

/** Timers that fire only when the test moves time forward. */
class ManualClock {
  private now = 0;
  private timers: { at: number; run: () => void; cancelled: boolean }[] = [];

  schedule = (ms: number, run: () => void) => {
    const timer = { at: this.now + ms, run, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };

  advance(ms: number): void {
    this.now += ms;
    const due = this.timers.filter((t) => t.at <= this.now && !t.cancelled);
    this.timers = this.timers.filter((t) => !due.includes(t));
    for (const timer of due) timer.run();
  }
}

async function setup() {
  const fixture = await createTestDatabase();
  cleanups.push(fixture.close);
  const store = new PolicyStore(fixture.db);
  await store.init();
  const channel = new FakeChannel();
  const clock = new ManualClock();
  const service = new ApprovalService({
    channel,
    store,
    logger: silentLogger,
    schedule: clock.schedule,
  });
  await service.init();
  const ask = (signal = new AbortController().signal) =>
    service.request({ tool: 'write_file', input: { path: 'a.txt' }, threadId: '7', signal });
  return { store, channel, clock, service, ask };
}

/** The id of the Approval behind the buttons of a sent message. */
const approvalId = (channel: FakeChannel, index = 0) =>
  channel.sent[index]?.actions?.[0]?.id.split(':')[1] ?? '';

describe.skipIf(!process.env.TEST_DATABASE_URL)('ApprovalService', () => {
  it('asks in the turn thread with Yes/No buttons and allows on yes', async () => {
    const { channel, service, ask } = await setup();
    const decision = ask();
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));

    expect(channel.sent[0]?.threadId).toBe('7');
    expect(channel.sent[0]?.actions?.map((a) => a.label)).toEqual(['Sì', 'No']);
    const id = approvalId(channel);
    await service.answer({
      type: 'action',
      actionId: `ap:${id}:y`,
      messageId: '1',
      receivedAt: new Date(),
    });

    expect(await decision).toBe('approved');
    expect(channel.edited).toEqual([
      { messageId: '1', markdown: expect.stringContaining('✅ Approvata.') },
    ]);
  });

  it('asks with the message the asker wrote, and keeps it in the outcome', async () => {
    const { channel, service } = await setup();
    const message = '🔐 **Posso ricordarmi questa preferenza?**\n\n> Ama il mare.';
    const decision = service.request({
      tool: 'memory',
      input: { fact: 'Ama il mare.' },
      message,
      threadId: '7',
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));

    expect(channel.sent[0]?.markdown).toBe(message);
    await service.answer({
      type: 'action',
      actionId: `ap:${approvalId(channel)}:n`,
      messageId: '1',
      receivedAt: new Date(),
    });

    expect(await decision).toBe('denied');
    expect(channel.edited).toEqual([{ messageId: '1', markdown: `${message}\n\n❌ Negata.` }]);
  });

  it('denies on no', async () => {
    const { channel, service, ask } = await setup();
    const decision = ask();
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));
    await service.answer({
      type: 'action',
      actionId: `ap:${approvalId(channel)}:n`,
      messageId: '1',
      receivedAt: new Date(),
    });

    expect(await decision).toBe('denied');
  });

  it('reminds once after 15 minutes and expires 15 minutes later', async () => {
    const { channel, clock, ask } = await setup();
    const decision = ask();
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));

    clock.advance(15 * MINUTE);
    await vi.waitFor(() => expect(channel.sent).toHaveLength(2));
    expect(channel.sent[1]?.markdown).toContain('Promemoria');

    clock.advance(15 * MINUTE);
    expect(await decision).toBe('expired');
    // Both messages lose their buttons.
    await vi.waitFor(() => expect(channel.edited.map((e) => e.messageId)).toEqual(['1', '2']));
    expect(channel.sent).toHaveLength(2);
  });

  it('counts only the first answer', async () => {
    const { channel, service, ask } = await setup();
    const decision = ask();
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));
    const id = approvalId(channel);
    const press = (choice: string) =>
      service.answer({
        type: 'action',
        actionId: `ap:${id}:${choice}`,
        messageId: '1',
        receivedAt: new Date(),
      });

    await press('n');
    await press('y');

    expect(await decision).toBe('denied');
    expect(channel.edited.at(-1)?.markdown).toContain('❌ Negata.');
  });

  it('expires when the turn ends while waiting', async () => {
    const { channel, ask } = await setup();
    const turn = new AbortController();
    const decision = ask(turn.signal);
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));

    turn.abort();

    expect(await decision).toBe('expired');
  });

  it('expires pending requests on stop, and those left by a previous process on init', async () => {
    const { store, channel, service, ask } = await setup();
    const decision = ask();
    await vi.waitFor(() => expect(channel.sent).toHaveLength(1));
    await service.stop();
    expect(await decision).toBe('expired');

    // A request the last process never decided.
    const left = await store.createApproval('write_file', {}, undefined);
    await store.addApprovalMessage(left.id, '99');
    const restarted = new ApprovalService({ channel, store, logger: silentLogger });
    await restarted.init();

    expect((await store.getApproval(left.id))?.status).toBe('expired');
    expect(channel.edited.at(-1)).toEqual({
      messageId: '99',
      markdown: expect.stringContaining('⌛'),
    });
  });

  it('tidies a press on a request it does not know', async () => {
    const { channel, service } = await setup();
    await service.answer({
      type: 'action',
      actionId: 'ap:00000000-0000-0000-0000-000000000000:y',
      messageId: '5',
      receivedAt: new Date(),
    });

    expect(channel.edited).toEqual([
      { messageId: '5', markdown: '⌛ Questa richiesta non è più valida.' },
    ]);
  });

  it('denies at once when the request cannot be sent', async () => {
    const { channel, ask } = await setup();
    channel.deletedThreads.add('7');

    expect(await ask()).toBe('expired');
  });
});
