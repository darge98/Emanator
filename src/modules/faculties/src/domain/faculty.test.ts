import { ENGINE_FACULTIES } from '@emanator/engine';
import { describe, expect, it } from 'vitest';
import { conversationTools } from '../server/conversation-tools.ts';
import { FACULTY_TOOLS } from './faculty.ts';

describe('Faculty catalogue', () => {
  it('lists exactly the Tools the Faculties provide', () => {
    const opener = { openAgentTopic: async () => ({ name: 'x', title: 'x' }) };
    const provided = [...ENGINE_FACULTIES, ...conversationTools(opener).map((t) => t.name)];

    expect(FACULTY_TOOLS.map((t) => t.name).sort()).toEqual(provided.sort());
  });

  it('asks before changing files and allows everything else', () => {
    expect(FACULTY_TOOLS.filter((t) => t.defaultPolicy === 'ask').map((t) => t.name)).toEqual([
      'write_file',
      'edit_file',
    ]);
  });
});
