import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_LENGTH, toToolOutput } from './capability-connections.ts';

describe('toToolOutput', () => {
  it('joins text and names what the model cannot read', () => {
    expect(
      toToolOutput({
        content: [
          { type: 'text', text: 'Two attachments:' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          { type: 'resource_link', uri: 'file:///a.pdf', name: 'a.pdf' },
        ],
      }),
    ).toEqual({
      text: 'Two attachments:\n[image not shown]\n[link: file:///a.pdf]',
      isError: false,
    });
  });

  it('falls back to structured content and keeps the error flag', () => {
    expect(toToolOutput({ content: [], structuredContent: { n: 1 }, isError: true })).toEqual({
      text: '{"n":1}',
      isError: true,
    });
  });

  it('cuts very long output and says so', () => {
    const { text } = toToolOutput({
      content: [{ type: 'text', text: 'x'.repeat(MAX_OUTPUT_LENGTH + 10) }],
    });
    expect(text.endsWith(`[… output cut at ${MAX_OUTPUT_LENGTH} characters]`)).toBe(true);
    expect(text.length).toBeLessThan(MAX_OUTPUT_LENGTH + 100);
  });
});
