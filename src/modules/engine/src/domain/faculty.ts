/**
 * Faculties the Engine implements with its own tools, named the Harness way (ADR 0002).
 * They reach the Engine's model only when a turn asks for them, and Policies apply to them
 * like to any other Tool.
 */
export const ENGINE_FACULTIES = ['web_search', 'web_fetch'] as const;

export type EngineFaculty = (typeof ENGINE_FACULTIES)[number];
