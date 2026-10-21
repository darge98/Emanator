import type { InboundAction, MessageAction } from '@emanator/channels';
import { isModel, MODELS, type ModelId, modelLabel } from '@emanator/engine';
import * as say from './messages.ts';

/** The model travels in the button's id, like a suggested reply: a press needs no state. */
const PREFIX = 'md:';
const DEFAULT = 'default';

/** One button per model and one for the default, marking the Conversation's own choice. */
export const modelActions = (chosen: string | undefined, defaultModel: string): MessageAction[] => [
  ...MODELS.map(({ id, label }) => ({
    id: `${PREFIX}${id}`,
    label: id === chosen ? `• ${label}` : label,
  })),
  {
    id: `${PREFIX}${DEFAULT}`,
    label: say.defaultModel(modelLabel(defaultModel), chosen === undefined),
    row: 1,
  },
];

/** What stays under the message once the Owner chose: the choice, which does nothing. */
export const chosenModelAction = (model: ModelId | null, defaultModel: string): MessageAction => ({
  id: PREFIX,
  label: `✓ ${model ? modelLabel(model) : say.defaultModel(modelLabel(defaultModel), false)}`,
});

export const isModelChoice = (event: InboundAction): boolean => event.actionId.startsWith(PREFIX);

/** The model a press chose, null for the default; undefined for a choice already made. */
export function chosenModel(event: InboundAction): ModelId | null | undefined {
  if (!isModelChoice(event)) return undefined;
  const choice = event.actionId.slice(PREFIX.length);
  if (choice === DEFAULT) return null;
  return isModel(choice) ? choice : undefined;
}
