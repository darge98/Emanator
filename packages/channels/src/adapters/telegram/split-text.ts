/** Telegram's limit for a plain text message. */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Splits text into chunks that fit a Telegram message, preferring paragraph,
 * then line, then word boundaries.
 */
export function splitText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const cut = bestCut(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

function bestCut(text: string, limit: number): number {
  const window = text.slice(0, limit);
  // A paragraph or line break is worth it only if it doesn't leave a tiny first chunk;
  // any space beats cutting a word in half.
  for (const [separator, minimum] of [
    ['\n\n', limit / 2],
    ['\n', limit / 2],
    [' ', 0],
  ] as const) {
    const at = window.lastIndexOf(separator);
    if (at > minimum) return at + separator.length;
  }
  return limit;
}
