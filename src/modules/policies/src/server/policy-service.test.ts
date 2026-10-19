import { silentLogger } from '@emanator/shared/server';
import { describe, expect, it, vi } from 'vitest';
import type { Policy, PolicyGroup, ToolGroup } from '../domain/policy.ts';
import { PolicyService } from './policy-service.ts';

const GROUPS: ToolGroup[] = [
  {
    kind: 'faculty',
    name: 'web',
    title: 'Web',
    tools: [{ name: 'web_search', title: 'Search', defaultPolicy: 'allow' }],
  },
  {
    kind: 'faculty',
    name: 'files',
    title: 'Files',
    tools: [
      { name: 'read_file', title: 'Read', defaultPolicy: 'allow', choices: ['allow', 'deny'] },
      { name: 'write_file', title: 'Write', defaultPolicy: 'ask' },
    ],
  },
];

const toolsOf = (groups: PolicyGroup[]) => groups.flatMap(({ tools }) => tools);

function setup(answer: 'approved' | 'denied' | 'expired' = 'approved', groups = GROUPS) {
  let chosen = new Map<string, Policy>();
  const store = {
    policies: async () => new Map(chosen),
    replacePolicies: async (next: ReadonlyMap<string, Policy>) => {
      chosen = new Map(next);
    },
  };
  const request = vi.fn(async () => answer);
  const service = new PolicyService({
    store,
    approvals: { request },
    groups: () => groups,
    logger: silentLogger,
  });
  return { service, request };
}

const use = (tool: string) => ({ tool, input: {}, signal: new AbortController().signal });

describe('PolicyService', () => {
  it('lists Tools by group with only what the dashboard shows', async () => {
    // A Faculty's Tool also carries its implementation, which must stay on the server.
    const implemented = {
      name: 'web_search',
      title: 'Search',
      defaultPolicy: 'allow' as const,
      run() {},
    };
    const { service } = setup('approved', [
      { kind: 'faculty', name: 'web', title: 'Web', tools: [implemented] },
    ]);

    expect(await service.list()).toEqual([
      {
        kind: 'faculty',
        name: 'web',
        title: 'Web',
        tools: [
          {
            name: 'web_search',
            title: 'Search',
            defaultPolicy: 'allow',
            policy: 'allow',
            custom: false,
          },
        ],
      },
    ]);
  });

  it('stores only choices that differ from the default', async () => {
    const { service } = setup();

    const saved = await service.save({ policies: { web_search: 'deny', write_file: 'ask' } });
    expect(toolsOf(saved).find((t) => t.name === 'web_search')).toMatchObject({
      policy: 'deny',
      custom: true,
    });
    expect(toolsOf(saved).find((t) => t.name === 'write_file')).toMatchObject({
      policy: 'ask',
      custom: false,
    });

    const reset = await service.save({ policies: { web_search: 'allow' } });
    expect(toolsOf(reset).find((t) => t.name === 'web_search')).toMatchObject({
      policy: 'allow',
      custom: false,
    });
  });

  it('leaves the Tools a save does not name as they were', async () => {
    const { service } = setup();
    await service.save({ policies: { web_search: 'deny' } });

    const saved = await service.save({ policies: { write_file: 'deny' } });

    expect(toolsOf(saved).map(({ name, policy }) => [name, policy])).toEqual([
      ['web_search', 'deny'],
      ['read_file', 'allow'],
      ['write_file', 'deny'],
    ]);
  });

  it('forgets the choices of Tools that are gone', async () => {
    const { service } = setup();
    await service.save({ policies: { web_search: 'deny', write_file: 'deny' } });

    await service.forget(['web_search', 'write_file', 'never_chosen']);

    expect(toolsOf(await service.list()).every(({ custom }) => !custom)).toBe(true);
  });

  it('saves nothing when any choice is invalid', async () => {
    const { service } = setup();
    await service.save({ policies: { web_search: 'deny' } });

    await expect(
      service.save({ policies: { web_search: 'allow', rm_rf: 'allow' } }),
    ).rejects.toThrow(/no Tool called "rm_rf"/);
    await expect(service.save({ policies: { web_search: 'maybe' } })).rejects.toThrow(
      /allow, ask, deny/,
    );
    await expect(service.save({ policies: { read_file: 'ask' } })).rejects.toThrow(/allow, deny/);
    expect(toolsOf(await service.list()).find((t) => t.name === 'web_search')?.policy).toBe('deny');
  });

  it('allows, denies and asks according to the Policy', async () => {
    const { service, request } = setup('denied');
    await service.save({ policies: { web_search: 'deny' } });
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
    await service.save({ policies: { write_file: 'deny' } });

    expect(await service.usable([{ name: 'web_search' }, { name: 'write_file' }])).toEqual([
      { name: 'web_search' },
    ]);
  });
});
