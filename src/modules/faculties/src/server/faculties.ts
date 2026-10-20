import type { TurnRequest } from '@emanator/engine';
import { TurnTrust } from '@emanator/memory';
import type {
  EngineFacultyTool,
  Faculty,
  FacultyTool,
  HarnessFacultyTool,
} from '../domain/faculty.ts';
import { type ConversationOpener, conversationsFaculty } from './conversations-faculty.ts';
import { filesFaculty } from './files-faculty.ts';
import { type MemoryKeeper, type MemoryTurn, memoryFaculty } from './memory-faculty.ts';
import { webFaculty } from './web-faculty.ts';

export interface FacultyDeps {
  conversations: ConversationOpener;
  memory: MemoryKeeper;
}

/** A turn of the Owner's that asks nobody: enough to list every Tool, for Policies. */
const LISTING_TURN: MemoryTurn = { trust: new TurnTrust('owner'), confirm: async () => false };

/**
 * Every Faculty of the Agent in v1; there is no shell yet. Memory's Tools depend on the
 * turn they serve, so each turn builds its own.
 */
export function agentFaculties(
  { conversations, memory }: FacultyDeps,
  turn: MemoryTurn = LISTING_TURN,
): Faculty[] {
  return [
    webFaculty,
    filesFaculty,
    memoryFaculty(memory, turn),
    conversationsFaculty(conversations),
  ];
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
