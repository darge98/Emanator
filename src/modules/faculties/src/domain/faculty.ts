import type { ToolInfo } from '@emanator/policies';

/** The Agent's innate abilities in v1 (see CONTEXT.md); there is no shell yet. */
export const FACULTIES = ['web', 'files', 'conversations'] as const;

export type Faculty = (typeof FACULTIES)[number];

const READ_CHOICES = ['allow', 'deny'] as const;

/**
 * Every Faculty Tool with its default Policy. Faculties have no MCP annotations, so the
 * defaults are fixed here (docs/v1-scope.md, Control): reading and opening a topic are
 * allowed, writing asks first. Web and files are the Engine's own tools; opening a
 * Conversation is the Harness's.
 */
export const FACULTY_TOOLS = [
  { name: 'web_search', group: 'web', defaultPolicy: 'allow' },
  { name: 'web_fetch', group: 'web', defaultPolicy: 'allow' },
  // The Engine reads inside the working folder without asking, so reads can't be *ask*.
  { name: 'read_file', group: 'files', defaultPolicy: 'allow', choices: READ_CHOICES },
  { name: 'find_files', group: 'files', defaultPolicy: 'allow', choices: READ_CHOICES },
  { name: 'search_files', group: 'files', defaultPolicy: 'allow', choices: READ_CHOICES },
  { name: 'write_file', group: 'files', defaultPolicy: 'ask' },
  { name: 'edit_file', group: 'files', defaultPolicy: 'ask' },
  { name: 'open_conversation', group: 'conversations', defaultPolicy: 'allow' },
] as const satisfies readonly (ToolInfo & { group: Faculty })[];
