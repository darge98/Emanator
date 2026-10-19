import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { leavesWorkingDirectory } from './workspace-guard.ts';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

async function workspace() {
  const base = await mkdtemp(join(tmpdir(), 'emanator-guard-'));
  folders.push(base);
  const root = join(base, 'workspace');
  await mkdir(root);
  await writeFile(join(base, 'secret.txt'), 'outside');
  await symlink(base, join(root, 'escape'));
  await symlink(join(base, 'missing'), join(root, 'broken'));
  return { base, root };
}

describe('leavesWorkingDirectory', () => {
  it('lets file tools work inside the working folder', async () => {
    const { root } = await workspace();
    const leaves = (tool: string, input: Record<string, unknown>) =>
      leavesWorkingDirectory(root, tool, input);

    expect(await leaves('Read', { file_path: join(root, 'notes/today.md') })).toBe(false);
    expect(await leaves('Write', { file_path: 'notes/new.md' })).toBe(false);
    expect(await leaves('Glob', { pattern: '**/*.md' })).toBe(false);
    expect(await leaves('Grep', { pattern: 'ciao' })).toBe(false);
    // A name that merely starts with two dots stays inside.
    expect(await leaves('Read', { file_path: '..notes' })).toBe(false);
  });

  it('refuses paths that lead outside, directly, by pattern or through a link', async () => {
    const { base, root } = await workspace();
    const leaves = (tool: string, input: Record<string, unknown>) =>
      leavesWorkingDirectory(root, tool, input);

    expect(await leaves('Read', { file_path: join(base, 'secret.txt') })).toBe(true);
    expect(await leaves('Edit', { file_path: '../secret.txt' })).toBe(true);
    expect(await leaves('Read', { file_path: 'escape/secret.txt' })).toBe(true);
    expect(await leaves('Write', { file_path: 'escape/new/file.txt' })).toBe(true);
    expect(await leaves('Read', { file_path: 'broken' })).toBe(true);
    expect(await leaves('Glob', { pattern: '../*' })).toBe(true);
    expect(await leaves('Grep', { pattern: 'x', path: '/etc' })).toBe(true);
  });

  it('ignores tools that touch no files', async () => {
    const { root } = await workspace();

    expect(await leavesWorkingDirectory(root, 'WebFetch', { url: 'https://example.com' })).toBe(
      false,
    );
  });
});
