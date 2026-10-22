import { ENGINE_TOOLS, type ToolOutput } from '@emanator/engine';
import { TurnTrust } from '@emanator/memory';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import type { HarnessFacultyTool } from '../domain/faculty.ts';
import { agentFaculties, turnAbilities } from './faculties.ts';

const opener = { openAgentTopic: async () => ({ name: 'x', title: 'x' }) };
const memory = {
  remember: async () => {
    throw new Error('unused');
  },
  forget: async () => {
    throw new Error('unused');
  },
  page: async () => undefined,
  pages: async () => [],
};
const unused = async () => {
  throw new Error('unused');
};
const routines = {
  list: unused,
  remind: unused,
  updateReminder: unused,
  createByAgent: unused,
  cancelByAgent: unused,
};
const tools = agentFaculties({
  conversations: opener,
  memory,
  routines,
  timeZone: () => 'Europe/Rome',
}).flatMap((faculty) => faculty.tools);

describe('Faculties', () => {
  it('expose every Engine Tool, each Tool once', () => {
    const names = tools.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([...ENGINE_TOOLS]));
  });

  it('ask before fetching pages, changing files or creating Routines, and allow the rest', () => {
    expect(tools.filter((t) => t.defaultPolicy === 'ask').map((t) => t.name)).toEqual([
      'web_fetch',
      'write_file',
      'edit_file',
      'create_routine',
    ]);
  });

  it("hand a turn the Engine's Tools by name and the Harness's to run", () => {
    const { tools: harness, engineTools } = turnAbilities(tools);

    expect(engineTools).toEqual([...ENGINE_TOOLS]);
    expect(harness.map(({ name }) => name)).toEqual([
      'remember',
      'forget',
      'recall',
      'open_conversation',
      'suggest_replies',
      'remind',
      'update_reminder',
      'cancel_reminder',
      'create_routine',
      'list_routines',
      'cancel_routine',
    ]);
    expect(harness[0]?.run).toBeTypeOf('function');
  });

  it('suggest replies only where someone can press them, and keep them short', async () => {
    const turn = { trust: new TurnTrust('owner'), confirm: async () => false };
    const names = (suggestReplies?: (replies: readonly string[]) => void) =>
      agentFaculties(
        { conversations: opener, memory, routines, timeZone: () => 'Europe/Rome' },
        { ...turn, ...(suggestReplies && { suggestReplies }) },
      )
        .flatMap((faculty) => faculty.tools)
        .map(({ name }) => name);
    expect(names()).not.toContain('suggest_replies');

    const suggested: (readonly string[])[] = [];
    const tool = agentFaculties(
      { conversations: opener, memory, routines, timeZone: () => 'Europe/Rome' },
      { ...turn, suggestReplies: (replies) => suggested.push(replies) },
    )
      .flatMap((faculty) => faculty.tools)
      .find(({ name }) => name === 'suggest_replies') as HarnessFacultyTool & {
      input: { replies: ZodType };
    };
    const run = tool.run as (input: { replies: string[] }) => Promise<ToolOutput>;

    await run({ replies: ['Sì', 'No'] });
    expect(suggested).toEqual([['Sì', 'No']]);
    expect(tool.input.replies.safeParse(['Sì', 'Sì']).success).toBe(false);
    expect(tool.input.replies.safeParse(['🌊'.repeat(16), 'No']).success).toBe(false);
    expect(tool.input.replies.safeParse(['Lerici', 'Levanto', 'Sestri']).success).toBe(true);
  });
});
