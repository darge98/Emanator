import { GrammyError } from 'grammy';

/** Telegram's answer when the topic a message targets was deleted. */
export function isThreadNotFound(error: unknown): boolean {
  return error instanceof GrammyError && /thread not found/i.test(error.description);
}

/** Renaming a topic to the name it already has. */
export function isTopicNotModified(error: unknown): boolean {
  return error instanceof GrammyError && /TOPIC_NOT_MODIFIED/i.test(error.description);
}

/** Editing a message to the text and buttons it already has, e.g. a press handled twice. */
export function isMessageNotModified(error: unknown): boolean {
  return error instanceof GrammyError && /message is not modified/i.test(error.description);
}

/** The message to edit was deleted, e.g. by the Owner. */
export function isMessageGone(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    /message to edit not found|MESSAGE_ID_INVALID/i.test(error.description)
  );
}

/**
 * Plain text is a fallback for one case only: Telegram rejected the rich message itself
 * (400 Bad Request, e.g. Markdown it can't parse or a message too long). Network errors,
 * 403s, rate limits and server errors have nothing to do with the format: retrying them as
 * plain text would fail again, or duplicate a message that did arrive.
 */
export function shouldFallBackToPlainText(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    !isThreadNotFound(error) &&
    !isMessageNotModified(error) &&
    !isMessageGone(error)
  );
}
