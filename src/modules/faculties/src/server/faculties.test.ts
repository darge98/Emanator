import { ENGINE_TOOLS } from '@emanator/engine';
import { describe, expect, it } from 'vitest';
import { agentFaculties, turnAbilities } from './faculties.ts';

const opener = { openAgentTopic: async () => ({ name: 'x', title: 'x' }) };
const tools = agentFaculties({ conversations: opener }).flatMap((faculty) => faculty.tools);

describe('Faculties', () => {
  it('expose every Engine Tool, each Tool once', () => {
    const names = tools.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([...ENGINE_TOOLS]));
  });

  it('ask before fetching pages or changing files, and allow everything else', () => {
    expect(tools.filter((t) => t.defaultPolicy === 'ask').map((t) => t.name)).toEqual([
      'web_fetch',
      'write_file',
      'edit_file',
    ]);
  });

  it("hand a turn the Engine's Tools by name and the Harness's to run", () => {
    const { tools: harness, engineTools } = turnAbilities(tools);

    expect(engineTools).toEqual([...ENGINE_TOOLS]);
    expect(harness.map(({ name }) => name)).toEqual(['open_conversation']);
    expect(harness[0]?.run).toBeTypeOf('function');
  });
});
