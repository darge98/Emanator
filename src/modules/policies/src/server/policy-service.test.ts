import { silentLogger } from '@emanator/shared/server';
import { describe, expect, it, vi } from 'vitest';
import type { Policy, ToolInfo } from '../domain/policy.ts';
import { PolicyService, UnknownToolError } from './policy-service.ts';

const TOOLS: ToolInfo[] = [
  { name: 'web_search', group: 'web', defaultPolicy: 'allow' },
  { name: 'write_file', group: 'files', defaultPolicy: 'ask' },
];

function setup(answer: 'approved' | 'denied' | 'expired' = 'approved') {
  const chosen = new Map<string, Policy>();
  const store = {
    policies: async () => new Map(chosen),
    setPolicy: async (tool: string, policy: Policy) => void chosen.set(tool, policy),
    resetPolicy: async (tool: string) => void chosen.delete(tool),
  };
  const request = vi.fn(async () => answer);
  const service = new PolicyService({
    store,
    approvals: { request },
    tools: () => TOOLS,
    logger: silentLogger,
  });
  return { service, request };
}

const use = (tool: string) => ({ tool, input: {}, signal: new AbortController().signal });

describe('PolicyService', () => {
  it('uses the default Policy until the Owner chooses one, and back after a reset', async () => {
    const { service } = setup();

    expect(await service.set('web_search', { policy: 'deny' })).toMatchObject({
      policy: 'deny',
      custom: true,
    });
    expect(await service.reset('web_search')).toMatchObject({ policy: 'allow', custom: false });
  });

  it('refuses unknown Tools and invalid Policies', async () => {
    const { service } = setup();

    await expect(service.set('rm_rf', { policy: 'allow' })).rejects.toThrow(UnknownToolError);
    await expect(service.set('web_search', { policy: 'maybe' })).rejects.toThrow(
      /allow, ask, deny/,
    );
  });

  it('allows, denies and asks according to the Policy', async () => {
    const { service, request } = setup('denied');
    await service.set('web_search', { policy: 'deny' });
    const onWaiting = vi.fn();
    const decide = service.decider({ thread: async () => '7', onWaiting });

    expect(await decide(use('web_search'))).toMatchObject({ behavior: 'deny' });
    expect(await decide(use('write_file'))).toEqual({
      behavior: 'deny',
      reason: 'The Owner did not approve this use of the Tool.',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'write_file', threadId: '7' }),
    );
    expect(onWaiting.mock.calls).toEqual([[true], [false]]);
  });

  it('allows an asked Tool once approved, and denies Tools nobody declared', async () => {
    const { service } = setup('approved');
    const decide = service.decider({ thread: async () => undefined });

    expect(await decide(use('write_file'))).toEqual({ behavior: 'allow' });
    expect(await decide(use('bash'))).toMatchObject({ behavior: 'deny' });
  });

  it('denies, without failing the turn, when deciding goes wrong', async () => {
    const { service } = setup();
    const decide = service.decider({
      thread: async () => {
        throw new Error('topic could not be opened');
      },
    });

    expect(await decide(use('write_file'))).toMatchObject({ behavior: 'deny' });
  });

  it('keeps the decision when reporting the wait fails', async () => {
    const { service } = setup('approved');
    const decide = service.decider({
      thread: async () => undefined,
      onWaiting: async () => {
        throw new Error('database down');
      },
    });

    expect(await decide(use('write_file'))).toEqual({ behavior: 'allow' });
  });

  it('hides denied Tools from the model', async () => {
    const { service } = setup();
    await service.set('write_file', { policy: 'deny' });

    expect(await service.usable([{ name: 'web_search' }, { name: 'write_file' }])).toEqual([
      { name: 'web_search' },
    ]);
  });
});
