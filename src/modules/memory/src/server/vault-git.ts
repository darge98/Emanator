import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { errorMessage, type Logger } from '@emanator/shared/server';

const run = promisify(execFile);

// The vault's own identity, so commits don't depend on the host's git config.
const IDENTITY = ['-c', 'user.name=Emanator', '-c', 'user.email=emanator@localhost'];

/**
 * The vault's history: one commit per change. A failing git never fails a write, which is
 * already on disk; it is only logged.
 */
export class VaultGit {
  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  async init(): Promise<void> {
    try {
      await access(join(this.dir, '.git'));
    } catch {
      await this.git(['init', '--quiet']);
    }
  }

  async commit(message: string): Promise<void> {
    await this.git(['add', '--all']);
    // Nothing to commit is not a failure: e.g. forgetting what was never there.
    const { stdout } = await this.git(['status', '--porcelain']);
    if (stdout.trim() === '') return;
    await this.git([...IDENTITY, 'commit', '--quiet', '--message', message]);
  }

  private async git(args: string[]): Promise<{ stdout: string }> {
    try {
      return await run('git', args, { cwd: this.dir });
    } catch (error) {
      this.logger.warn('Git failed on the Memory vault', { args, error: errorMessage(error) });
      return { stdout: '' };
    }
  }
}
