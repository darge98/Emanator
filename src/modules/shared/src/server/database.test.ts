import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe.skipIf(!process.env.TEST_DATABASE_URL)('openDatabase', () => {
  it('logs a disconnected idle client and serves the next query with a new connection', () => {
    // Isolate the process: an unhandled Pool error must fail this test, not the test runner.
    const script = `
      import assert from 'node:assert/strict';
      import { openDatabase } from ${JSON.stringify(new URL('./database.ts', import.meta.url).href)};
      process.once('uncaughtException', (error) => {
        console.error('Unhandled idle connection error: ' + error.message);
        process.exit(42);
      });
      const errors = [];
      let reportError;
      const reported = new Promise(resolve => { reportError = resolve; });
      const logger = { info() {}, warn() {}, error(message, details) {
        errors.push({ message, details });
        reportError();
      }};
      const db = await openDatabase(process.env.TEST_DATABASE_URL, logger);
      const control = await openDatabase(process.env.TEST_DATABASE_URL);
      let timeout;
      try {
        const { rows: [{ pid }] } = await db.query('SELECT pg_backend_pid() AS pid');
        // Terminate only this child process's test connection, never a Harness connection.
        await control.query('SELECT pg_terminate_backend($1)', [pid]);
        await Promise.race([
          reported,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Pool did not report the disconnect')), 2000);
          }),
        ]);
        assert.equal(errors.length, 1);
        assert.match(errors[0].details.error, /terminating connection/);
        const { rows: [replacement] } = await db.query('SELECT pg_backend_pid() AS pid, 1 AS ok');
        assert.notEqual(replacement.pid, pid);
        assert.equal(replacement.ok, 1);
      } finally {
        clearTimeout(timeout);
        await db.end();
        await control.end();
      }
    `;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
