import type { TurnRequest } from '@emanator/engine';
import type {
  EngineFacultyTool,
  Faculty,
  FacultyTool,
  HarnessFacultyTool,
} from '../domain/faculty.ts';
import { type ConversationOpener, conversationsFaculty } from './conversations-faculty.ts';
import { filesFaculty } from './files-faculty.ts';
import { webFaculty } from './web-faculty.ts';

export interface FacultyDeps {
  conversations: ConversationOpener;
}

/** Every Faculty of the Agent in v1; there is no shell yet. */
export function agentFaculties({ conversations }: FacultyDeps): Faculty[] {
  return [webFaculty, filesFaculty, conversationsFaculty(conversations)];
}

/** Hands a turn its Faculty Tools: the Engine's by name, the Harness's to run. */
export function turnAbilities(
  tools: readonly FacultyTool[],
): Required<Pick<TurnRequest, 'tools' | 'engineTools'>> {
  return {
    tools: tools.filter((tool): tool is HarnessFacultyTool => !('engine' in tool)),
    engineTools: tools
      .filter((tool): tool is EngineFacultyTool => 'engine' in tool)
      .map(({ name }) => name),
  };
}
