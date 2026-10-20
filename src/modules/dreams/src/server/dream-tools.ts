import { defineTool, type ToolDefinition } from '@emanator/engine';
import { sameTitle } from '@emanator/memory';
import { MemoryError, type MemoryService } from '@emanator/memory/server';
import { z } from 'zod';
import type { AskedFact } from '../domain/dream.ts';

/** The most Facts one Dream asks the Owner about. */
export const MAX_ASKED = 5;

/** In the log and the commits, the Dream's writes read apart from the Agent's. */
const BY_DREAM = 'dal Sogno';

/** What one Dream wrote, filled in as it goes. */
export interface DreamNotes {
  noted: number;
  asked: AskedFact[];
}

/**
 * The Dream's only writing Tool: inferred Facts, never preferences or instructions, and no
 * new kinds (ADR 0009). It may set the summary and aliases of a Page it creates.
 */
export function noteTool(
  memory: Pick<MemoryService, 'page' | 'remember'>,
  notes: DreamNotes,
): ToolDefinition {
  return defineTool({
    name: 'note',
    description:
      'Saves one inferred Fact on a Memory Page, creating the Page if needed. Link other Pages by writing [[Title]] in the text.',
    input: {
      page: z.string().trim().min(1).describe('Title of the Page, e.g. "Marco Rossi"'),
      kind: z.string().optional().describe('Kind of a new Page, one of the listed kinds'),
      summary: z.string().max(200).optional().describe('For a new Page: one line for the index'),
      aliases: z.array(z.string()).optional().describe('For a new Page: other names it goes by'),
      fact: z.string().trim().min(1).max(1000).describe('The Fact, one sentence, in Italian'),
      source: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe('Where it comes from, e.g. "chat con Mamma"'),
      ask: z.boolean().default(false).describe('True to ask the Owner tomorrow morning'),
    },
    hints: { readOnly: false },
    run: async (input) => {
      const existing = await memory.page(input.page);
      if (existing?.facts.some(({ text }) => sameTitle(text, input.fact))) {
        return { text: `[[${existing.title}]] already has this Fact.` };
      }
      try {
        const { page, fact } = await memory.remember({
          page: input.page,
          ...(input.kind !== undefined && { kind: input.kind }),
          ...(!existing && input.summary !== undefined && { summary: input.summary }),
          ...(!existing && input.aliases !== undefined && { aliases: input.aliases }),
          mayAddKind: false,
          fact: input.fact,
          factKind: 'fact',
          trust: 'inferred',
          source: input.source,
          by: BY_DREAM,
        });
        notes.noted += 1;
        const asking = input.ask && notes.asked.length < MAX_ASKED;
        if (asking) {
          notes.asked.push({ page: page.title, id: fact.id, text: fact.text, source: fact.source });
        }
        const full =
          input.ask && !asking ? ` Already ${MAX_ASKED} to ask: saved without asking.` : '';
        return { text: `Saved on [[${page.title}]] as ^${fact.id}.${full}` };
      } catch (error) {
        if (error instanceof MemoryError) return { text: error.message, isError: true };
        throw error;
      }
    },
  });
}
