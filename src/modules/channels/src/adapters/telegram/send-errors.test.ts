import { GrammyError, HttpError } from 'grammy';
import { describe, expect, it } from 'vitest';
import { isThreadNotFound, shouldFallBackToPlainText } from './send-errors.ts';

const telegramError = (error_code: number, description: string) =>
  new GrammyError(description, { ok: false, error_code, description }, 'sendRichMessage', {});

describe('shouldFallBackToPlainText', () => {
  it('falls back when Telegram rejects the rich message itself', () => {
    expect(shouldFallBackToPlainText(telegramError(400, "Bad Request: can't parse entities"))).toBe(
      true,
    );
  });

  it.each([
    ['a deleted topic', telegramError(400, 'Bad Request: message thread not found')],
    ['a blocked bot', telegramError(403, 'Forbidden: bot was blocked by the user')],
    ['a rate limit', telegramError(429, 'Too Many Requests: retry after 5')],
    ['a Telegram server error', telegramError(502, 'Bad Gateway')],
    ['a network failure', new HttpError('Network request failed', new Error('ETIMEDOUT'))],
  ])('does not fall back on %s', (_case, error) => {
    expect(shouldFallBackToPlainText(error)).toBe(false);
  });
});

describe('isThreadNotFound', () => {
  it('recognises a deleted topic, and nothing else', () => {
    expect(isThreadNotFound(telegramError(400, 'Bad Request: message thread not found'))).toBe(
      true,
    );
    expect(isThreadNotFound(telegramError(400, "Bad Request: can't parse entities"))).toBe(false);
  });
});
