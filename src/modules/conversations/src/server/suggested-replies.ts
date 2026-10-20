import type { InboundAction, MessageAction } from '@emanator/channels';

/**
 * A suggested reply travels in its button's id, so a press needs no stored state and still
 * works after a restart. Ids hold 64 bytes, the prefix included.
 */
const PREFIX = 'rp:';

export const replyActions = (replies: readonly string[]): MessageAction[] =>
  replies.map((reply) => ({ id: `${PREFIX}${reply}`, label: reply }));

/** What stays under a message once the Owner chose: the choice, which does nothing. */
export const chosenAction = (reply: string): MessageAction => ({ id: PREFIX, label: `✓ ${reply}` });

export const isSuggestedReply = (event: InboundAction): boolean =>
  event.actionId.startsWith(PREFIX);

/** The reply a press chose; undefined for the choice already made, or another button. */
export function chosenReply(event: InboundAction): string | undefined {
  return (isSuggestedReply(event) && event.actionId.slice(PREFIX.length)) || undefined;
}
