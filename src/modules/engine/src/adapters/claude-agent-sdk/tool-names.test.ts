import { describe, expect, it } from 'vitest';
import { fromSdkToolName, sdkToolOfFaculty, toSdkToolName } from './tool-names.ts';

describe('tool names', () => {
  it('round-trips Harness Tools through the in-process server prefix', () => {
    expect(toSdkToolName('read_file')).toBe('mcp__emanator__read_file');
    expect(fromSdkToolName('mcp__emanator__read_file')).toBe('read_file');
  });

  it('names built-in tools after the Faculty they implement', () => {
    expect(sdkToolOfFaculty('web_search')).toBe('WebSearch');
    expect(fromSdkToolName('WebSearch')).toBe('web_search');
    expect(fromSdkToolName('WebFetch')).toBe('web_fetch');
  });

  it('leaves unknown names unchanged', () => {
    expect(fromSdkToolName('Bash')).toBe('Bash');
    expect(fromSdkToolName('mcp__other__tool')).toBe('mcp__other__tool');
  });
});
