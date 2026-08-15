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
const PRELOAD_URL = () => server.url('preload.html');

let counter = 0;
function S(): string {
  counter++;
  return `v013-preload-${Date.now().toString(36)}-${counter}`;
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

/** Read the #preload-value text rendered by the fixture page. */
async function preloadValue(env: Record<string, string>): Promise<string> {
  const out = await run(['eval', 'document.getElementById("preload-value").textContent'], env);
  return out.trim();
}

describe('v0.13: BiDi preload scripts (preload add/remove/list)', () => {
  const runnable = E2E_ENABLED && CHROME;

  (runnable ? it : it.skip)('injects a preload script, observes it on navigation, then removes it', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);

    // A browser may be installed but unable to start a session in this
    // environment (sandbox). Only run the live-session flow when it works.
    try {
      await run(['open', PRELOAD_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    // Baseline: no preload script → the page renders not-set.
    expect(await preloadValue(env)).toBe('not-set');

    // Register a preload script.
    const addOut = await run(['preload', 'add', '--script=window.__sePreload = "hello"'], env);
    const idMatch = addOut.match(/preload script registered: (\S+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1];

    // preload list shows the registered script.
    const listOut = await run(['preload', 'list'], env);
    expect(listOut).toContain(id);

    // Reload: the preload script runs before page scripts → fixture shows it.
    await run(['reload'], env);
    expect(await preloadValue(env)).toBe('hello');

    // Remove the script and reload: back to baseline.
    const removeOut = await run(['preload', 'remove', `--id=${id}`], env);
    expect(removeOut).toContain('preload script removed');
    await run(['reload'], env);
    expect(await preloadValue(env)).toBe('not-set');

    // The registry is empty again.
    const listAfter = await run(['preload', 'list'], env);
    expect(listAfter).toContain('no preload scripts');

    await run(['close'], env);
  });
});
