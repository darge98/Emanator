/**
 * The models the Owner chooses from, by the Engine's aliases, which follow each family's
 * latest version. A list rather than free text, so a typo can't break a turn.
 */
export const MODELS = [
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

export const DEFAULT_MODEL: ModelId = 'sonnet';

export const isModel = (value: unknown): value is ModelId => MODELS.some(({ id }) => id === value);

/** The model's name for the Owner; an id outside the list, e.g. saved before it, as it is. */
export const modelLabel = (id: string): string =>
  MODELS.find((model) => model.id === id)?.label ?? id;
