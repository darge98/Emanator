import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The paths a built-in file tool would touch, read from its input; undefined for tools
 * that touch no files. Glob patterns count too, since `../*` would search outside.
 */
function pathsOf(sdkTool: string, input: Record<string, unknown>): string[] | undefined {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  switch (sdkTool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return [text(input.file_path) ?? ''];
    case 'Glob': {
      const base = text(input.path) ?? '.';
      const pattern = text(input.pattern) ?? '';
      // join() would keep an absolute pattern inside the base; Glob searches from it.
      const paths = [base, isAbsolute(pattern) ? pattern : join(base, pattern)];
      // Braces hide alternatives from resolution, e.g. `{a,../..}/*` or `{a,/etc}/*`.
      if (pattern.split(/[/{},]/).includes('..') || /[{,]\//.test(pattern)) paths.push('..');
      return paths;
    }
    case 'Grep':
      return [text(input.path) ?? '.'];
    default:
      return undefined;
  }
}

/**
 * True when a built-in file tool would reach outside `workingDirectory`, directly, with
 * `..`, or through a symlink. Paths are checked after resolving links, so a link inside the
 * folder can't lead out; a broken link counts as outside.
 */
export async function leavesWorkingDirectory(
  workingDirectory: string,
  sdkTool: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  const paths = pathsOf(sdkTool, input);
  if (!paths) return false;
  const base = await realpath(workingDirectory);
  for (const path of paths) {
    if (!(await isInside(base, resolve(base, path)))) return true;
  }
  return false;
}

/**
 * `target` is already free of `..`, so the parts that don't exist yet can't lead anywhere:
 * the real path of the nearest existing ancestor decides. Comparing only real paths also
 * accepts a working folder reached through a link, e.g. /var -> /private/var on macOS.
 */
async function isInside(base: string, target: string): Promise<boolean> {
  let existing = target;
  while (!(await exists(existing))) existing = dirname(existing);
  const real = await realpath(existing).catch(() => undefined);
  return real !== undefined && contains(base, real);
}

function contains(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel.split(sep)[0] !== '..' && !isAbsolute(rel);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
