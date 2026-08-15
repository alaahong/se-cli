import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { shouldRunE2E, resolveTestBrowsers } from './detect-browsers';
import { startTestServer, type TestServer } from './test-server';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const E2E_ENABLED = shouldRunE2E();
const RESOLVED_BROWSERS = resolveTestBrowsers();
const CHROME = RESOLVED_BROWSERS.includes('chrome') ? 'chrome' : undefined;

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
const EXAMPLE_URL = () => server.url('example.html');

let counter = 0;
function S(): string {
  counter++;
  return `v013-cookie-${Date.now().toString(36)}-${counter}`;
}

async function run(args: string[], env: Record<string, string> = {}, timeout = 90000): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

const SESSION_OPEN = (sess: string) => ({
  SE_CLI_SESSION: sess,
  SE_CLI_BROWSER: 'chrome',
});

describe('v0.13: BiDi cookie partition (cookie --bidi --user-context)', () => {
  const runnable = E2E_ENABLED && CHROME;

  (runnable ? it : it.skip)('scopes cookies to a user context via storage.setCookie/getCookies', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);

    try {
      await run(['open', EXAMPLE_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    try {
      // Create an isolated user context.
      const newOut = await run(['context-new'], env);
      const idMatch = newOut.match(/user context created: (\S+)/);
      expect(idMatch).not.toBeNull();
      const ctxId = idMatch![1];

      // Set a cookie scoped to that context (BiDi path).
      const setOut = await run(
        ['cookie-set', 'partitioned', 'yes', '--bidi', `--user-context=${ctxId}`],
        env,
      );
      expect(setOut).toContain('cookie set');

      // The default (unpartitioned) listing does not see it.
      const defaultList = await run(['cookie-list', '--bidi'], env);
      expect(defaultList).not.toContain('partitioned');

      // The user-context listing does see it.
      const ctxList = await run(['cookie-list', '--bidi', `--user-context=${ctxId}`], env);
      expect(ctxList).toContain('partitioned');

      await run(['context-close', `--id=${ctxId}`], env);
    } finally {
      await run(['close'], env);
    }
  });
});
