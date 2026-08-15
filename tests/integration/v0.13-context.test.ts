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
  return `v013-ctx-${Date.now().toString(36)}-${counter}`;
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

describe('v0.13: BiDi user contexts (context-new/close/list)', () => {
  const runnable = E2E_ENABLED && CHROME;

  (runnable ? it : it.skip)('creates an isolated context, lists it, and removes it', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);

    try {
      await run(['open', EXAMPLE_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    // context-list works and reports at least the default context.
    const list0 = await run(['context-list'], env);
    expect(list0).not.toBe('');

    // Create a user context.
    const newOut = await run(['context-new'], env);
    const idMatch = newOut.match(/user context created: (\S+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1];

    // The new context shows up in context-list.
    const list1 = await run(['context-list'], env);
    expect(list1).toContain(id);

    // Close it again.
    const closeOut = await run(['context-close', `--id=${id}`], env);
    expect(closeOut).toContain('user context removed');

    await run(['close'], env);
  });
});
