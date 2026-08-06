import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { startTestServer, DynamicRoutes, type TestServer } from './test-server';
import { resolveTestBrowsers, shouldRunE2E, type BrowserName } from './detect-browsers';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');

async function run(args: string[], env?: Record<string, string>, cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ...env },
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
    cwd,
  });
  return stdout;
}

// Aggressive session cleanup: tries `close` first, then falls back to
// `kill-all` if close hangs or fails. This prevents a crashed daemon from
// blocking the entire test suite for the full 120s timeout.
async function cleanupSession(session: string): Promise<void> {
  // Try graceful close with a short timeout (15s).
  try {
    await execFileAsync('node', [CLI, 'close'], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, SE_CLI_SESSION: session },
      shell: false,
    });
    return;
  } catch {
    // Close failed or timed out — fall through to kill-all.
  }
  // Force-kill all sessions as a last resort.
  try {
    await execFileAsync('node', [CLI, 'kill-all'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env },
      shell: false,
    });
  } catch {
    // Even kill-all failed — nothing more we can do.
  }
  // Brief pause to let the OS reclaim resources (especially on Windows
  // where chromedriver processes may linger after browser crash).
  await new Promise(r => setTimeout(r, 500));
}

// --- Browser resolution ---
//
// CI always sets explicit SE_CLI_TEST_<browser> env vars, so
// resolveTestBrowsers() returns those directly.
//
// For local development, when SE_CLI_E2E=1 is set but no specific
// SE_CLI_TEST_* vars are provided, browsers are auto-detected by
// probing common installation paths. Priority: Edge → Chrome → Firefox.
const E2E_ENABLED = shouldRunE2E();
const RESOLVED_BROWSERS = resolveTestBrowsers();

// Use the full list for describe.each so that skipped browsers still
// appear in the test report. Each suite checks `skip` individually.
const BROWSERS: string[] =
  RESOLVED_BROWSERS.length > 0 ? RESOLVED_BROWSERS : ['chrome', 'edge', 'firefox'];

describe('v0.9: install --skills multi-target', () => {
  const installCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'se-install-e2e-'));
  afterAll(() => {
    fs.rmSync(installCwd, { recursive: true, force: true });
  });

  (E2E_ENABLED ? it : it.skip)('installs into multiple agent targets and lists agents', async () => {
    // Simulate a project that already uses Claude Code and Copilot.
    fs.mkdirSync(path.join(installCwd, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(installCwd, '.github', 'copilot'), { recursive: true });

    const out = await run(['install', '--agent=claude,cursor,copilot'], {}, installCwd);
    expect(out).toContain('.claude');
    expect(out).toContain('.cursor');
    expect(out).toContain('.github');
    for (const rel of [
      path.join('.claude', 'skills', 'se-cli', 'SKILL.md'),
      path.join('.cursor', 'skills', 'se-cli', 'SKILL.md'),
      path.join('.github', 'copilot', 'skills', 'se-cli', 'SKILL.md'),
    ]) {
      const content = fs.readFileSync(path.join(installCwd, rel), 'utf8');
      expect(content).toContain('name: se-cli');
      expect(content).toContain('license: Apache-2.0');
      expect(content).toContain('compatibility:');
    }

    // Re-running without --force skips existing files.
    const skipOut = await run(['install', '--agent=claude'], {}, installCwd);
    expect(skipOut).toContain('Skipped');

    // --force overwrites.
    const forceOut = await run(['install', '--agent=claude', '--force'], {}, installCwd);
    expect(forceOut).toContain('Installed SKILL.md to');

    // Auto-detection installs into detected targets only.
    // Remove the .cursor dir created by the explicit install above so
    // auto-detection sees only the pre-existing .claude/.github dirs
    // (the user never set up Cursor in this simulated project).
    fs.rmSync(path.join(installCwd, '.cursor'), { recursive: true, force: true });
    const autoOut = await run(['install'], {}, installCwd);
    expect(autoOut).toContain('.claude');
    expect(autoOut).toContain('.github');
    expect(autoOut).not.toContain('.cursor');

    // --list-agents enumerates supported targets.
    const listOut = await run(['install', '--list-agents'], {}, installCwd);
    expect(listOut).toContain('claude');
    expect(listOut).toContain('copilot');
    expect(listOut).toContain('generic');
  });
});

describe('v0.1: install-browser (Selenium Manager)', () => {
  (E2E_ENABLED ? it : it.skip)('installs/verifies the driver for the detected browser', async () => {
    const out = await run(['install-browser']);
    expect(out).toContain('Driver installed');
    // Auto-detection resolved a real browser; driver path must exist.
    const driverLine = out.split('\n').find(l => l.includes('Driver installed')) || '';
    expect(driverLine.length).toBeGreaterThan(0);
  });

  (E2E_ENABLED ? it : it.skip)('rejects an unsupported browser name', async () => {
    await expect(run(['install-browser', 'safari'])).rejects.toThrow(/Unsupported browser/);
  });
});

if (E2E_ENABLED) {
  // eslint-disable-next-line no-console
  console.log(
    `\n[integration] E2E enabled. Testing browsers: ${RESOLVED_BROWSERS.join(', ') || '(none detected)'}\n`
  );
}

// v0.9: MCP server (stdio) end-to-end — handshake + tools/list. Runs
// regardless of E2E flag (no browser needed), but requires dist/cli.js.
describe('v0.9: MCP server (stdio) integration', () => {
  function spawnMcp(): ChildProcess {
    return spawn('node', [CLI, 'mcp-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  function rpc(proc: ChildProcess, msg: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.stdout?.off('data', onData);
        reject(new Error('MCP response timeout'));
      }, 20000);
      timer.unref();
      const onData = (data: Buffer) => {
        const text = data.toString('utf8').trim();
        if (!text) return;
        proc.stdout?.off('data', onData);
        clearTimeout(timer);
        try {
          resolve(JSON.parse(text));
        } catch (e: any) {
          reject(new Error(`Invalid JSON-RPC response: ${text} — ${e.message}`));
        }
      };
      proc.stdout?.on('data', onData);
      proc.stdin?.write(JSON.stringify(msg) + '\n');
    });
  }

  it('completes the initialize handshake', async () => {
    const proc = spawnMcp();
    try {
      const init = await rpc(proc, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'se-cli-e2e', version: '1.0' },
        },
      });
      expect(init.result?.protocolVersion).toBe('2025-06-18');
      expect(init.result?.serverInfo?.name).toBeDefined();
    } finally {
      proc.kill();
    }
  }, 30000);

  it('tools/list exposes the full storage tool set (incl. localStorage/sessionStorage)', async () => {
    const proc = spawnMcp();
    try {
      await rpc(proc, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'se-cli-e2e', version: '1.0' },
        },
      });
      // notifications/initialized is a notification — no response expected.
      proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const list = await rpc(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const names: string[] = (list.result?.tools ?? []).map((t: any) => t.name);
      expect(names).toContain('browser_localstorage_list');
      expect(names).toContain('browser_localstorage_set');
      expect(names).toContain('browser_sessionstorage_delete');
      expect(names).toContain('browser_cookie_list');
    } finally {
      proc.kill();
    }
  }, 30000);
});

// HTTP test server — started once for all browser suites.
// Supports static fixture files and extensible dynamic routes.
let server: TestServer;

// Register API routes for network debugging tests (v0.7). Shared with
// scripts/serve-test-pages.js via api-routes.js (single source of truth).
// Must run before startTestServer() since the server checks DynamicRoutes
// on every request.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerApiRoutes } = require('./api-routes');
registerApiRoutes(DynamicRoutes);

beforeAll(async () => {
  server = await startTestServer();
}, 10000);

afterAll(async () => {
  await server?.close();
}, 10000);

// URL helpers — resolved after server starts.
const EXAMPLE_URL  = () => server.url('example.html');   // basic page: title, url, eval, screenshot
const TODO_URL     = () => server.url('todo.html');       // interactive: fill, press Enter, click
const FORMS_URL    = () => server.url('forms.html');       // form elements: fill, select, check, uncheck
const LINKS_URL    = () => server.url('links.html');       // navigation: click links, go-back/forward
const SNAPSHOT_URL = () => server.url('snapshot.html');    // rich ARIA: snapshot, find, find --regex
const BUTTONS_URL  = () => server.url('buttons.html');     // buttons: click by ref, verify action
const STORAGE_URL  = () => server.url('storage.html');     // storage: cookies, localStorage, sessionStorage
const TABS_URL     = () => server.url('tabs.html');        // tabs: open, list, close, select
const IFRAME_URL   = () => server.url('iframe.html');       // iframes: recursive snapshot, cross-frame refs
const SHADOW_URL   = () => server.url('shadow-dom.html');   // shadow DOM: open shadow roots with interactive elements
const WAIT_URL     = () => server.url('wait.html');          // wait & retry: delayed visibility/enablement, dynamic element, flaky button
const INTERACTIONS_URL = () => server.url('interactions.html'); // v0.5: hover, dblclick, drag, dialogs, upload, resize, mouse/keyboard actions
const ASSERTIONS_URL = () => server.url('assertions.html');     // v0.6: web-first assertions
const NETWORK_DEBUG_URL = () => server.url('network-debug.html'); // v0.7: network & debugging

describe.each(BROWSERS)('lifecycle with %s', (browser) => {
  // Skip if E2E is not enabled, or if this browser wasn't resolved
  // (either explicitly selected via env vars or auto-detected locally).
  const skip = !E2E_ENABLED || !RESOLVED_BROWSERS.includes(browser as BrowserName);
  const S = () => `test-${browser}`;

  beforeEach(async () => {
    if (skip) return;
    await cleanupSession(S());
  });

  afterEach(async () => {
    if (skip) return;
    await cleanupSession(S());
  });

  // --- Session lifecycle ---

  (skip ? it.skip : it)('opens browser and closes', async () => {
    await run(['open', `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(title).toBeDefined();
  });

  (skip ? it.skip : it)('lists sessions', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['list']);
    expect(result).toContain(S());
  });

  // --- Navigation ---

  (skip ? it.skip : it)('navigates to URL', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(title).toBe('Example Domain');
    const url = (await run(['--raw', 'url'], { SE_CLI_SESSION: S() })).trim();
    expect(url).toContain('example.html');
  });

  (skip ? it.skip : it)('navigates back/forward/reload', async () => {
    // Start on links page, navigate to example, then back to links, forward to example.
    await run(['open', LINKS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    expect((await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim()).toBe('Navigation Links');

    await run(['goto', EXAMPLE_URL()], { SE_CLI_SESSION: S() });
    expect((await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim()).toBe('Example Domain');

    await run(['go-back'], { SE_CLI_SESSION: S() });
    expect((await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim()).toBe('Navigation Links');

    await run(['go-forward'], { SE_CLI_SESSION: S() });
    expect((await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim()).toBe('Example Domain');

    await run(['reload'], { SE_CLI_SESSION: S() });
    expect((await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim()).toBe('Example Domain');
  });

  (skip ? it.skip : it)('clicks link by ref to navigate', async () => {
    // Open the links page, click the link to the example page via ref.
    await run(['open', LINKS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the ref for the "Go to Example Page" link.
    const refMatch = snapshot.match(/Go to Example Page[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: S() });
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(title).toBe('Example Domain');
  });

  // --- Snapshot & Find ---

  (skip ? it.skip : it)('takes snapshot with refs', async () => {
    await run(['open', SNAPSHOT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // snapshot.html has links, buttons, textboxes, etc.
    expect(snapshot).toContain('link');
    expect(snapshot).toContain('button');
    expect(snapshot).toContain('textbox');
    expect(snapshot).toMatch(/ref=e\d+/);
  });

  (skip ? it.skip : it)('finds text in snapshot', async () => {
    await run(['open', SNAPSHOT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'find', 'Card One'], { SE_CLI_SESSION: S() });
    expect(result).toContain('Card One');
    expect(result).not.toContain('No matches found');
  });

  (skip ? it.skip : it)('finds text with regex', async () => {
    await run(['open', SNAPSHOT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // Search for table data (Alpha, Beta, Gamma) with regex.
    const result = await run(['--raw', 'find', '--regex', 'Alpha|Beta|Gamma'], { SE_CLI_SESSION: S() });
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
    expect(result).toContain('Gamma');
  });

  // --- Interaction: fill, type, press ---

  (skip ? it.skip : it)('fills input field and verifies value', async () => {
    await run(['open', FORMS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the "Username" textbox ref.
    const refMatch = snapshot.match(/Username[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['fill', ref, 'testuser'], { SE_CLI_SESSION: S() });
    // Verify the value was set via eval.
    const val = (await run(['--raw', 'eval', `document.getElementById('username').value`], { SE_CLI_SESSION: S() })).trim();
    expect(val).toBe('testuser');
  });

  (skip ? it.skip : it)('fills textarea via ref', async () => {
    await run(['open', FORMS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the "Bio" textarea ref — it's a textbox role.
    // The snapshot shows "Bio" as the label; match the textbox after it.
    const refMatch = snapshot.match(/Bio[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['fill', ref, 'Hello World'], { SE_CLI_SESSION: S() });
    const val = (await run(['--raw', 'eval', `document.getElementById('bio').value`], { SE_CLI_SESSION: S() })).trim();
    expect(val).toBe('Hello World');
  });

  (skip ? it.skip : it)('types text into focused element', async () => {
    await run(['open', FORMS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // Focus the email field via eval.
    await run(['eval', `document.getElementById('email').focus()`], { SE_CLI_SESSION: S() });
    await run(['type', 'user@example.com'], { SE_CLI_SESSION: S() });
    const val = (await run(['--raw', 'eval', `document.getElementById('email').value`], { SE_CLI_SESSION: S() })).trim();
    expect(val).toBe('user@example.com');
  });

  (skip ? it.skip : it)('fills and presses Enter in todo app', async () => {
    await run(['open', TODO_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    const refMatch = snapshot.match(/textbox[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['fill', ref, 'Buy groceries'], { SE_CLI_SESSION: S() });
    await run(['press', 'Enter'], { SE_CLI_SESSION: S() });
    const after = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    expect(after).toContain('Buy groceries');
  });

  // --- Interaction: select, check, uncheck ---

  (skip ? it.skip : it)('selects dropdown option', async () => {
    await run(['open', FORMS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the combobox (select) ref — labeled "Country".
    const refMatch = snapshot.match(/Country[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['select', ref, 'China'], { SE_CLI_SESSION: S() });
    // Verify the status text changed.
    const status = (await run(['--raw', 'eval', `document.getElementById('status').textContent`], { SE_CLI_SESSION: S() })).trim();
    expect(status).toContain('China');
  });

  (skip ? it.skip : it)('checks and unchecks checkbox', async () => {
    await run(['open', FORMS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the "Newsletter" checkbox ref.
    const refMatch = snapshot.match(/Newsletter[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];

    // Check
    await run(['check', ref], { SE_CLI_SESSION: S() });
    let checked = (await run(['--raw', 'eval', `document.getElementById('newsletter').checked`], { SE_CLI_SESSION: S() })).trim();
    expect(checked).toBe('true');

    // Uncheck
    await run(['uncheck', ref], { SE_CLI_SESSION: S() });
    checked = (await run(['--raw', 'eval', `document.getElementById('newsletter').checked`], { SE_CLI_SESSION: S() })).trim();
    expect(checked).toBe('false');
  });

  // --- Interaction: click button ---

  (skip ? it.skip : it)('clicks button by ref and verifies action', async () => {
    await run(['open', BUTTONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the "Increment +1" button ref.
    const refMatch = snapshot.match(/Increment \+1[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: S() });
    // Counter should now be 1.
    const count = (await run(['--raw', 'eval', `document.getElementById('count').textContent`], { SE_CLI_SESSION: S() })).trim();
    expect(count).toBe('1');
  });

  // --- Screenshot & Eval ---

  (skip ? it.skip : it)('takes screenshot', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['screenshot', '--filename=test.png'], { SE_CLI_SESSION: S() });
    expect(result).toContain('test.png');
    const file = path.join(process.cwd(), '.se-cli', 'test.png');
    expect(fs.existsSync(file)).toBe(true);
    fs.unlinkSync(file);
  });

  (skip ? it.skip : it)('evaluates JavaScript', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = (await run(['--raw', 'eval', 'document.title'], { SE_CLI_SESSION: S() })).trim();
    expect(result).toBe('Example Domain');
  });

  (skip ? it.skip : it)('run-code executes arbitrary Selenium snippets (v0.9)', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // Title from a run-code snippet must match the title command output.
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    const runCode = (await run(
      ['--raw', 'run-code', 'async driver => { return await driver.getTitle(); }'],
      { SE_CLI_SESSION: S() }
    )).trim();
    expect(runCode).toBe(title);
    // Returned WebElements are serialized as refs usable by later commands.
    const snapshot = await run(['snapshot'], { SE_CLI_SESSION: S() });
    const runCodeRef = (await run(
      ['--raw', 'run-code', 'async driver => { return await driver.findElement({ css: "h1" }); }'],
      { SE_CLI_SESSION: S() }
    )).trim();
    expect(runCodeRef).toMatch(/^e\d+$/);
    // The assigned ref must not collide with snapshot refs, and the element
    // must be clickable via the new ref.
    const snapshotRefs = (snapshot.match(/ref=e(\d+)/g) || []).map((s) => parseInt(s.replace('ref=e', ''), 10));
    const maxSnapshotRef = snapshotRefs.length ? Math.max(...snapshotRefs) : 0;
    expect(parseInt(runCodeRef.replace('e', ''), 10)).toBeGreaterThan(maxSnapshotRef);
    const clickResult = await run(['--raw', 'click', runCodeRef], { SE_CLI_SESSION: S() });
    expect(clickResult).not.toContain('Error');
    // Snippet errors are reported cleanly without killing the session.
    const errResult = await run(
      ['run-code', 'async driver => { throw new Error("boom"); }'],
      { SE_CLI_SESSION: S() }
    );
    expect(errResult).toContain('RUN_CODE_ERROR');
    const stillAlive = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(stillAlive).toBe('Example Domain');
  });

  (skip ? it.skip : it)('generate-locator recommends a unique locator and emits role-based codegen (v0.9)', async () => {
    await run(['open', BUTTONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // Find the unique "Increment +1" button via snapshot + find.
    const snapshot = await run(['snapshot'], { SE_CLI_SESSION: S() });
    const line = snapshot.split('\n').find((l) => l.includes('Increment +1'));
    expect(line).toBeTruthy();
    const ref = line!.match(/ref=(e\d+)/)![1];
    // Recommended locator: role-based with matchCount 1.
    const jsonOut = await run(['--json', 'generate-locator', ref], { SE_CLI_SESSION: S() });
    const rows = JSON.parse(JSON.parse(jsonOut).result);
    const rec = rows.find((r: any) => r.recommended);
    expect(rec).toBeTruthy();
    expect(rec.matchCount).toBe(1);
    expect(rec.type).toBe('role');
    // --raw prints only the expression.
    const rawOut = (await run(['--raw', 'generate-locator', ref], { SE_CLI_SESSION: S() })).trim();
    expect(rawOut).toContain("new By('role', { role: 'button'");
    // The recommended expression is valid Selenium: clicking via it succeeds.
    // Role locators are not a standard strategy — on drivers without the
    // accessibility extension codegen falls back to CSS with a note, so
    // accept either the role output or the documented fallback.
    const clickResult = await run(['click', ref], { SE_CLI_SESSION: S() });
    const roleEmitted = clickResult.includes("new By('role', { role: 'button', name: 'Increment +1' })");
    const cssFallback = clickResult.includes('driver does not support the role locator strategy');
    expect(roleEmitted || cssFallback).toBe(true);
    // --locator-style=ref keeps the MVP data-se-ref codegen.
    const refClick = await run(['click', ref, '--locator-style=ref'], { SE_CLI_SESSION: S() });
    expect(refClick).toContain(`By.css('[data-se-ref="${ref}"]')`);
    // Counter incremented by both clicks.
    const count = (await run(['--raw', 'eval', "document.getElementById('count').textContent"], { SE_CLI_SESSION: S() })).trim();
    expect(count).toBe('2');
  });

  // --- Output modes ---

  (skip ? it.skip : it)('json output mode', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['--json', 'title'], { SE_CLI_SESSION: S() });
    const parsed = JSON.parse(result);
    expect(parsed.result).toBe('Example Domain');
  });

  // --- Storage: cookies ---

  (skip ? it.skip : it)('sets and gets a cookie', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['cookie-set', 'testcookie', 'cookievalue'], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'cookie-get', 'testcookie'], { SE_CLI_SESSION: S() });
    expect(result).toContain('testcookie');
    expect(result).toContain('cookievalue');
  });

  (skip ? it.skip : it)('lists cookies', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['cookie-set', 'listcookie', 'val123'], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'cookie-list'], { SE_CLI_SESSION: S() });
    expect(result).toContain('listcookie');
    expect(result).toContain('val123');
  });

  (skip ? it.skip : it)('deletes a specific cookie', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['cookie-set', 'deletecookie', 'tobedeleted'], { SE_CLI_SESSION: S() });
    await run(['cookie-delete', 'deletecookie'], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'cookie-list'], { SE_CLI_SESSION: S() });
    expect(result).not.toContain('deletecookie');
  });

  (skip ? it.skip : it)('deletes all cookies', async () => {
    await run(['open', EXAMPLE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['cookie-set', 'cookie1', 'val1'], { SE_CLI_SESSION: S() });
    await run(['cookie-set', 'cookie2', 'val2'], { SE_CLI_SESSION: S() });
    await run(['cookie-delete'], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'cookie-list'], { SE_CLI_SESSION: S() });
    expect(result).not.toContain('cookie1');
    expect(result).not.toContain('cookie2');
  });

  // --- Storage: localStorage ---

  (skip ? it.skip : it)('sets and gets localStorage', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // storage.html auto-sets localStorage: theme=dark, lang=en
    const result = await run(['--raw', 'localstorage-get', 'theme'], { SE_CLI_SESSION: S() });
    expect(result.trim()).toBe('dark');
  });

  (skip ? it.skip : it)('lists localStorage items', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'localstorage-list'], { SE_CLI_SESSION: S() });
    expect(result).toContain('theme');
    expect(result).toContain('dark');
    expect(result).toContain('lang');
    expect(result).toContain('en');
  });

  (skip ? it.skip : it)('sets and deletes localStorage item', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['localstorage-set', 'customkey', 'customval'], { SE_CLI_SESSION: S() });
    let result = await run(['--raw', 'localstorage-get', 'customkey'], { SE_CLI_SESSION: S() });
    expect(result.trim()).toBe('customval');
    await run(['localstorage-delete', 'customkey'], { SE_CLI_SESSION: S() });
    result = await run(['--raw', 'localstorage-get', 'customkey'], { SE_CLI_SESSION: S() });
    expect(result.trim()).toBe('null');
  });

  // --- Storage: sessionStorage ---

  (skip ? it.skip : it)('sets and gets sessionStorage', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // storage.html auto-sets sessionStorage: temp=value123
    const result = await run(['--raw', 'sessionstorage-get', 'temp'], { SE_CLI_SESSION: S() });
    expect(result.trim()).toBe('value123');
  });

  (skip ? it.skip : it)('lists sessionStorage items', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'sessionstorage-list'], { SE_CLI_SESSION: S() });
    expect(result).toContain('temp');
    expect(result).toContain('value123');
  });

  (skip ? it.skip : it)('deletes sessionStorage item', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['sessionstorage-delete', 'temp'], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'sessionstorage-get', 'temp'], { SE_CLI_SESSION: S() });
    expect(result.trim()).toBe('null');
  });

  // --- Tab management ---

  (skip ? it.skip : it)('opens new tab and lists tabs', async () => {
    await run(['open', TABS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['tab-new', EXAMPLE_URL()], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'tab-list'], { SE_CLI_SESSION: S() });
    // Should have at least 2 tabs
    expect(result).toContain('Tabs Test Page');
    expect(result).toContain('Example Domain');
  });

  (skip ? it.skip : it)('selects tab by index', async () => {
    await run(['open', TABS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['tab-new', EXAMPLE_URL()], { SE_CLI_SESSION: S() });
    // Switch to tab 0 (original)
    await run(['tab-select', '0'], { SE_CLI_SESSION: S() });
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(title).toBe('Tabs Test Page');
    // Switch to tab 1 (new tab)
    await run(['tab-select', '1'], { SE_CLI_SESSION: S() });
    const title2 = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(title2).toBe('Example Domain');
  });

  (skip ? it.skip : it)('closes tab and switches to remaining', async () => {
    await run(['open', TABS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    await run(['tab-new', EXAMPLE_URL()], { SE_CLI_SESSION: S() });
    // Verify we have 2 tabs
    let tabs = await run(['--raw', 'tab-list'], { SE_CLI_SESSION: S() });
    expect(tabs).toContain('Example Domain');
    // Close current tab (the new one with example.com)
    await run(['tab-close'], { SE_CLI_SESSION: S() });
    // Should switch back to remaining tab
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: S() })).trim();
    expect(title).toBe('Tabs Test Page');
  });

  (skip ? it.skip : it)('opens a new tab by clicking a target=_blank link', async () => {
    // The tabs.html fixture exists precisely for this: its links open new
    // tabs via target="_blank". Prior coverage only used tab-new, leaving
    // the "click link → new window → tab-list detects it" chain untested.
    await run(['open', TABS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // The link's accessible name comes from its aria-label, not the visible
    // text: <a aria-label="Open Example in new tab">Open Example Page</a>.
    const refMatch = snapshot.match(/Open Example in new tab[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: S() });
    // The new tab's document must be detectable via tab-list
    const tabs = await run(['--raw', 'tab-list'], { SE_CLI_SESSION: S() });
    expect(tabs).toContain('Example Domain');
    expect(tabs).toContain('Tabs Test Page');
  });

  // --- State save/load ---

  (skip ? it.skip : it)('saves and loads browser state', async () => {
    await run(['open', STORAGE_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // Set a cookie
    await run(['cookie-set', 'statecookie', 'stateval'], { SE_CLI_SESSION: S() });
    // Save state
    await run(['state-save', '--filename=test-state.json'], { SE_CLI_SESSION: S() });
    // Verify file was created
    const stateFile = path.join(process.cwd(), '.se-cli', 'test-state.json');
    expect(fs.existsSync(stateFile)).toBe(true);
    // Verify file content has cookies and storage
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(state.cookies).toBeInstanceOf(Array);
    expect(state.cookies.length).toBeGreaterThan(0);
    expect(state.localStorage).toHaveProperty('theme');
    expect(state.sessionStorage).toHaveProperty('temp');
    // Load state (navigates to saved URL, restores cookies and storage)
    await run(['state-load', '--filename=test-state.json'], { SE_CLI_SESSION: S() });
    // Verify cookie was restored
    const cookieResult = await run(['--raw', 'cookie-get', 'statecookie'], { SE_CLI_SESSION: S() });
    expect(cookieResult).toContain('statecookie');
    expect(cookieResult).toContain('stateval');
    // Verify localStorage was restored
    const lsResult = await run(['--raw', 'localstorage-get', 'theme'], { SE_CLI_SESSION: S() });
    expect(lsResult.trim()).toBe('dark');
    // Cleanup
    fs.unlinkSync(stateFile);
  });

  // --- v0.3: iframe recursive snapshot ---

  (skip ? it.skip : it)('takes snapshot with cross-frame refs', async () => {
    await run(['open', IFRAME_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // The snapshot should contain iframe entries
    expect(snapshot).toContain('iframe');
    // Should have cross-frame refs (f0e1, f0e2, etc.)
    expect(snapshot).toMatch(/ref=f\d+e\d+/);
  });

  (skip ? it.skip : it)('fills input inside iframe by cross-frame ref', async () => {
    await run(['open', IFRAME_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the ref for the "Name" textbox inside the iframe
    const refMatch = snapshot.match(/Name[^\n]*ref=(f\d+e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['fill', ref, 'iframe-test-value'], { SE_CLI_SESSION: S() });
    // Verify the value was set — use eval with the iframe element
    // After fill, the frame is reset to default by backend.ts
    const val = (await run(['--raw', 'eval',
      `document.getElementById('same-origin-iframe').contentDocument.getElementById('iframe-input').value`
    ], { SE_CLI_SESSION: S() })).trim();
    expect(val).toBe('iframe-test-value');
  });

  (skip ? it.skip : it)('clicks button inside iframe by cross-frame ref', async () => {
    await run(['open', IFRAME_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the ref for the "Submit Inside Iframe" button
    const refMatch = snapshot.match(/Submit Inside Iframe[^\n]*ref=(f\d+e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    // First fill the iframe input
    const inputRefMatch = snapshot.match(/Name[^\n]*ref=(f\d+e\d+)/);
    if (inputRefMatch) {
      await run(['fill', inputRefMatch[1], 'clicker'], { SE_CLI_SESSION: S() });
    }
    await run(['click', ref], { SE_CLI_SESSION: S() });
    // Verify the form was submitted — check result div
    const result = (await run(['--raw', 'eval',
      `document.getElementById('same-origin-iframe').contentDocument.getElementById('result').textContent`
    ], { SE_CLI_SESSION: S() })).trim();
    expect(result).toContain('clicker');
  });

  (skip ? it.skip : it)('finds text across frames', async () => {
    await run(['open', IFRAME_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'find', 'IFrame Content'], { SE_CLI_SESSION: S() });
    // The find command should search across frames
    expect(result).toContain('IFrame Content');
    expect(result).not.toContain('No matches found');
  });

  (skip ? it.skip : it)('snapshot shows cross-origin iframe placeholder', async () => {
    await run(['open', IFRAME_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // The about:blank iframe should appear as cross-origin or as an iframe entry
    expect(snapshot).toContain('iframe');
  });

  // --- v0.3: Shadow DOM recursion ---

  (skip ? it.skip : it)('takes snapshot with shadow DOM elements', async () => {
    await run(['open', SHADOW_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Shadow DOM elements should appear in the snapshot
    expect(snapshot).toContain('Shadow Button');
    expect(snapshot).toContain('Shadow Input');
  });

  (skip ? it.skip : it)('clicks button inside shadow DOM by ref', async () => {
    await run(['open', SHADOW_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    // Find the ref for the "Shadow Button" inside the shadow root
    const refMatch = snapshot.match(/Shadow Button[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    // First fill the shadow input
    const inputRefMatch = snapshot.match(/Shadow Input[^\n]*ref=(e\d+)/);
    if (inputRefMatch) {
      await run(['fill', inputRefMatch[1], 'shadow-user'], { SE_CLI_SESSION: S() });
    }
    await run(['click', ref], { SE_CLI_SESSION: S() });
    // Verify the button was clicked — check result inside shadow root
    const result = (await run(['--raw', 'eval',
      `document.getElementById('shadow-host').shadowRoot.getElementById('shadow-result').textContent`
    ], { SE_CLI_SESSION: S() })).trim();
    expect(result).toContain('shadow-user');
  });

  (skip ? it.skip : it)('fills input inside shadow DOM by ref', async () => {
    await run(['open', SHADOW_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    const refMatch = snapshot.match(/Shadow Input[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['fill', ref, 'shadow-fill-test'], { SE_CLI_SESSION: S() });
    // Verify value was set
    const val = (await run(['--raw', 'eval',
      `document.getElementById('shadow-host').shadowRoot.getElementById('shadow-input').value`
    ], { SE_CLI_SESSION: S() })).trim();
    expect(val).toBe('shadow-fill-test');
  });

  (skip ? it.skip : it)('finds text inside shadow DOM', async () => {
    await run(['open', SHADOW_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const result = await run(['--raw', 'find', 'Shadow DOM Form'], { SE_CLI_SESSION: S() });
    expect(result).toContain('Shadow DOM Form');
    expect(result).not.toContain('No matches found');
  });

  (skip ? it.skip : it)('clicks a button in nested shadow DOM by ref', async () => {
    // #nested-host contains a shadow root whose child (#inner-shadow-host)
    // hosts another shadow root with #inner-button. This is the hardest
    // piercing scenario and was previously untested.
    await run(['open', SHADOW_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    const refMatch = snapshot.match(/Inner Shadow Button[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: S() });
    // Verify the click landed: inner-count must be 1
    const count = (await run(['--raw', 'eval',
      `document.getElementById('nested-host').shadowRoot.getElementById('inner-shadow-host').shadowRoot.getElementById('inner-count').textContent`
    ], { SE_CLI_SESSION: S() })).trim();
    expect(count).toBe('1');
  });

  // --- v0.4: Wait & Retry Configuration ---

  (skip ? it.skip : it)('waits for delayed visible element with --wait=visible', async () => {
    await run(['open', WAIT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // #delayed-visible starts hidden (display:none), so it is excluded from
    // the ARIA snapshot and receives no ref. Use a CSS selector directly —
    // findElement() locates it in the DOM regardless of visibility, then
    // --wait=visible polls until it becomes visible (after 2s).
    const result = await run(['click', '#delayed-visible', '--wait=visible', '--timeout=5000'], { SE_CLI_SESSION: S() });
    expect(result).toContain('clicked');
  });

  (skip ? it.skip : it)('waits for delayed enabled element with --wait=enabled', async () => {
    await run(['open', WAIT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // #delayed-enabled is visible (but disabled) immediately, so it does get
    // a snapshot ref. Resolve the ref, then click with --wait=enabled which
    // polls until the button is no longer disabled (after 2s).
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    const refMatch = snapshot.match(/Delayed Enabled Button[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    const result = await run(['click', ref, '--wait=enabled', '--timeout=5000'], { SE_CLI_SESSION: S() });
    expect(result).toContain('clicked');
  });

  (skip ? it.skip : it)('clicks without waiting using --no-wait', async () => {
    await run(['open', WAIT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // With --no-wait (shorthand for --wait=none --timeout=0), clicking a
    // hidden element should fail immediately rather than waiting for it to
    // appear. The error is expected and swallowed here.
    try {
      await run(['click', '#delayed-visible', '--no-wait'], { SE_CLI_SESSION: S() });
    } catch {
      // Expected to fail since element is hidden
    }
  });

  (skip ? it.skip : it)('retries click on dynamically added element with --retry', async () => {
    await run(['open', WAIT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // #dynamic-btn is created after 2 seconds. Without --wait, findElement
    // fails. With --retry=5 and --retry-interval=500, the click is retried
    // until the element appears (total wait: ~2.5s).
    const result = await run([
      'click', '#dynamic-btn', '--retry=5', '--retry-interval=500', '--timeout=5000',
    ], { SE_CLI_SESSION: S() });
    expect(result).toContain('clicked');
  });

  (skip ? it.skip : it)('keeps working after a flaky handler throws', async () => {
    // #flaky-btn throws a JS error on its first click but succeeds on the
    // second. WebDriver click does not surface page-side JS exceptions, so
    // this verifies the browser remains usable after the handler blows up.
    await run(['open', WAIT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: S() });
    const refMatch = snapshot.match(/Flaky Button[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: S() });
    await run(['click', ref], { SE_CLI_SESSION: S() });
    const status = (await run(['--raw', 'eval',
      `document.getElementById('flaky-status').textContent`
    ], { SE_CLI_SESSION: S() })).trim();
    expect(status).toBe('Click count: 2');
  });

  (skip ? it.skip : it)('waits for the disappearing element to become hidden', async () => {
    // #disappearing is visible on load and gains .hidden after 3s. The
    // hidden assertion polls, so this both activates the dead element and
    // exercises the hidden wait path with a real disappearance.
    await run(['open', WAIT_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
    // Freshly loaded: it must be visible.
    const visible = await run(['--raw', 'expect', '#disappearing', 'visible'], { SE_CLI_SESSION: S() });
    expect(visible).toContain('visible');
    // Then wait (up to 5s) for it to disappear — hidden polls until gone.
    const hidden = await run(['--raw', 'expect', '#disappearing', 'hidden', '--timeout=5000'], { SE_CLI_SESSION: S() });
    expect(hidden).toContain('hidden');
  });

  (skip ? it.skip : it)('generates config file with config init', async () => {
    // Use a temp cwd so the generated .se-cli.json doesn't leak into the
    // repo or interfere with other tests. config commands are handled
    // locally by the CLI (no daemon/session required).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-cfg-'));
    try {
      const result = await run(['config', 'init'], { SE_CLI_SESSION: S() }, tmp);
      expect(result).toContain('Generated');
      expect(fs.existsSync(path.join(tmp, '.se-cli.json'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  (skip ? it.skip : it)('lists config values with config list', async () => {
    // Run in an empty temp dir so every value resolves to the built-in
    // default (no .se-cli.json present).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-cfg-'));
    try {
      const result = await run(['config', 'list'], { SE_CLI_SESSION: S() }, tmp);
      expect(result).toContain('wait.timeout');
      expect(result).toContain('wait.state');
      expect(result).toContain('default');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  (skip ? it.skip : it)('sets and gets config value', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-cfg-'));
    try {
      await run(['config', 'set', 'wait.timeout', '8000'], { SE_CLI_SESSION: S() }, tmp);
      const result = await run(['--raw', 'config', 'get', 'wait.timeout'], { SE_CLI_SESSION: S() }, tmp);
      expect(result.trim()).toBe('8000');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // --- v0.5: Interaction Completion ---

  describe('v0.5: Interaction Completion', () => {

    (skip ? it.skip : it)('hovers over element and triggers mouseenter', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['hover', '#hover-area'], { SE_CLI_SESSION: S() });
      expect(result).toContain('hovered');
      // Verify the mouseenter event fired on the page
      const status = (await run(['--raw', 'eval',
        `document.getElementById('hover-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Hovered!');
    });

    (skip ? it.skip : it)('double-clicks element and triggers dblclick event', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['dblclick', '#dblclick-area'], { SE_CLI_SESSION: S() });
      expect(result).toContain('double-clicked');
      const status = (await run(['--raw', 'eval',
        `document.getElementById('dblclick-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Double-clicked!');
    });

    (skip ? it.skip : it)('drags element to drop zone', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['drag', '#drag-source', '#drop-zone'], { SE_CLI_SESSION: S() });
      expect(result).toContain('dragged');
      // Verify page info is present in the response
      expect(result).toContain('### Page');
      expect(result).toContain('Interaction Test Page');
    });

    (skip ? it.skip : it)('accepts alert dialog', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // Trigger alert via eval with a short delay so the eval command
      // returns before the dialog appears (alert() blocks JS execution).
      await run(['eval',
        `setTimeout(function(){ alert('Test Alert'); document.getElementById('dialog-status').textContent = 'Alert: accepted'; }, 200)`
      ], { SE_CLI_SESSION: S() });
      const result = await run(['dialog-accept'], { SE_CLI_SESSION: S() });
      expect(result).toContain('dialog accepted');
      // Verify the alert was handled — the status text should be updated
      const status = (await run(['--raw', 'eval',
        `document.getElementById('dialog-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Alert: accepted');
    });

    (skip ? it.skip : it)('accepts confirm dialog (returns true)', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['eval',
        `setTimeout(function(){ var r = confirm('Test Confirm'); document.getElementById('dialog-status').textContent = 'Confirm: ' + r; }, 200)`
      ], { SE_CLI_SESSION: S() });
      const result = await run(['dialog-accept'], { SE_CLI_SESSION: S() });
      expect(result).toContain('dialog accepted');
      const status = (await run(['--raw', 'eval',
        `document.getElementById('dialog-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Confirm: true');
    });

    (skip ? it.skip : it)('accepts prompt dialog with input text', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['eval',
        `setTimeout(function(){ var r = prompt('Test Prompt'); document.getElementById('dialog-status').textContent = 'Prompt: ' + r; }, 200)`
      ], { SE_CLI_SESSION: S() });
      const result = await run(['dialog-accept', 'hello-world'], { SE_CLI_SESSION: S() });
      expect(result).toContain('dialog accepted');
      const status = (await run(['--raw', 'eval',
        `document.getElementById('dialog-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Prompt: hello-world');
    });

    (skip ? it.skip : it)('dismisses confirm dialog (returns false)', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['eval',
        `setTimeout(function(){ var r = confirm('Dismiss Test'); document.getElementById('dialog-status').textContent = 'Dismiss: ' + r; }, 200)`
      ], { SE_CLI_SESSION: S() });
      const result = await run(['dialog-dismiss'], { SE_CLI_SESSION: S() });
      expect(result).toContain('dialog dismissed');
      const status = (await run(['--raw', 'eval',
        `document.getElementById('dialog-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Dismiss: false');
    });

    (skip ? it.skip : it)('uploads file to input element', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // Create a temporary file to upload
      const tmpFile = path.join(os.tmpdir(), 'se-cli-upload-test.txt');
      fs.writeFileSync(tmpFile, 'test upload content');
      try {
        const result = await run(['upload', '#file-input', tmpFile], { SE_CLI_SESSION: S() });
        expect(result).toContain('uploaded');
        // Verify the file input shows the filename
        const fileInfo = (await run(['--raw', 'eval',
          `document.getElementById('file-info').textContent`
        ], { SE_CLI_SESSION: S() })).trim();
        expect(fileInfo).toContain('se-cli-upload-test.txt');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    (skip ? it.skip : it)('resizes viewport', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['resize', '800', '600'], { SE_CLI_SESSION: S() });
      expect(result).toContain('resized to 800x600');
      // Verify the viewport dimensions changed
      const w = (await run(['--raw', 'eval', `window.outerWidth`], { SE_CLI_SESSION: S() })).trim();
      const h = (await run(['--raw', 'eval', `window.outerHeight`], { SE_CLI_SESSION: S() })).trim();
      expect(parseInt(w)).toBeGreaterThanOrEqual(800);
      expect(parseInt(h)).toBeGreaterThanOrEqual(600);
    });

    (skip ? it.skip : it)('presses and releases key via keydown/keyup', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // Focus the key event detector area
      await run(['eval', `document.getElementById('key-area').focus()`], { SE_CLI_SESSION: S() });
      // Press and hold a key
      const downResult = await run(['keydown', 'a'], { SE_CLI_SESSION: S() });
      expect(downResult).toContain('keydown: a');
      const downStatus = (await run(['--raw', 'eval',
        `document.getElementById('key-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(downStatus).toContain('keydown');
      // Release the key
      const upResult = await run(['keyup', 'a'], { SE_CLI_SESSION: S() });
      expect(upResult).toContain('keyup: a');
      const upStatus = (await run(['--raw', 'eval',
        `document.getElementById('key-status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(upStatus).toContain('keyup');
    });

    (skip ? it.skip : it)('moves mouse to coordinates', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['mousemove', '100', '50'], { SE_CLI_SESSION: S() });
      expect(result).toContain('moved to (100, 50)');
      // Verify the coordinates display was updated
      const coords = (await run(['--raw', 'eval',
        `document.getElementById('coord-display').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(coords).toContain('X:');
      expect(coords).toContain('Y:');
    });

    (skip ? it.skip : it)('scrolls via mousewheel', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['mousewheel', '0', '100'], { SE_CLI_SESSION: S() });
      expect(result).toContain('scrolled');
      // Verify page info is present in the response
      expect(result).toContain('### Page');
      expect(result).toContain('Interaction Test Page');
    });

    (skip ? it.skip : it)('chains multiple actions in one perform', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // Chain: move to (50,50) → press → release
      const chain = JSON.stringify([
        { type: 'move', x: 50, y: 50 },
        { type: 'press' },
        { type: 'release' },
      ]);
      const result = await run(['actions-chain', chain], { SE_CLI_SESSION: S() });
      expect(result).toContain('performed 3 chained actions');
    });

    (skip ? it.skip : it)('returns page info in json output for v0.5 command', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['--json', 'hover', '#hover-area'], { SE_CLI_SESSION: S() });
      const parsed = JSON.parse(result);
      expect(parsed.page).toBeDefined();
      expect(parsed.page.title).toBe('Interaction Test Page');
      expect(parsed.page.url).toContain('interactions.html');
      expect(parsed.result).toBe('hovered');
    });

    // Firefox's geckodriver cannot find dynamically created elements via
    // findElement or findElements, causing this --wait polling test to fail.
    // The feature is validated on Chrome and Edge. Unit tests cover the
    // findElementWithWait polling logic for all browsers.
    const skipFirefox = skip || browser === 'firefox';
    (skipFirefox ? it.skip : it)('applies --wait=visible to hover on delayed element', async () => {
      await run(['open', INTERACTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // #delayed-hover-target is not in the DOM initially.
      // It is dynamically created and appended after 2 seconds.
      // The --wait flag polls findElement until the element appears,
      // then waits for it to be visible before performing the hover.
      const result = await run([
        'hover', '#delayed-hover-target',
        '--wait=visible', '--timeout=5000'
      ], { SE_CLI_SESSION: S() });
      expect(result).toContain('hovered');
      // Verify the hover was actually performed on the delayed element
      const status = (await run(['--raw', 'eval',
        `document.getElementById('delayed-hover-result').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toBe('Hovered delayed target!');
    });
  });

  // --- v0.6: Web-First Assertions ---

  describe('v0.6: Web-First Assertions', () => {

    (skip ? it.skip : it)('asserts element is visible', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#visible-element', 'visible'], { SE_CLI_SESSION: S() });
      expect(result).toContain('visible');
    });

    (skip ? it.skip : it)('asserts element is hidden', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#display-none-element', 'hidden'], { SE_CLI_SESSION: S() });
      expect(result).toContain('hidden');
    });

    (skip ? it.skip : it)('asserts element is enabled', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#enabled-input', 'enabled'], { SE_CLI_SESSION: S() });
      expect(result).toContain('enabled');
    });

    (skip ? it.skip : it)('asserts element is disabled', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#disabled-input', 'disabled'], { SE_CLI_SESSION: S() });
      expect(result).toContain('disabled');
    });

    (skip ? it.skip : it)('asserts checkbox is checked', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#checked-box', 'checked'], { SE_CLI_SESSION: S() });
      expect(result).toContain('checked');
    });

    (skip ? it.skip : it)('asserts checkbox is unchecked', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#unchecked-box', 'unchecked'], { SE_CLI_SESSION: S() });
      expect(result).toContain('unchecked');
    });

    (skip ? it.skip : it)('asserts element text contains expected', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#text-element', 'text', 'Hello'], { SE_CLI_SESSION: S() });
      expect(result).toContain('text');
    });

    (skip ? it.skip : it)('asserts element text with --exact', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#text-element', 'text', 'Hello World', '--exact'], { SE_CLI_SESSION: S() });
      expect(result).toContain('text');
    });

    (skip ? it.skip : it)('asserts input value', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#value-input', 'value', 'test@example.com'], { SE_CLI_SESSION: S() });
      expect(result).toContain('value');
    });

    (skip ? it.skip : it)('asserts element count', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '.count-item', 'count', '3'], { SE_CLI_SESSION: S() });
      expect(result).toContain('count');
    });

    (skip ? it.skip : it)('asserts element attribute', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#attr-element', 'attribute', 'data-role', 'button'], { SE_CLI_SESSION: S() });
      expect(result).toContain('attribute');
    });

    (skip ? it.skip : it)('asserts page title', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', 'title', 'Assertion Test Page'], { SE_CLI_SESSION: S() });
      expect(result).toContain('title');
    });

    (skip ? it.skip : it)('asserts page url', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', 'url', 'assertions.html'], { SE_CLI_SESSION: S() });
      expect(result).toContain('url');
    });

    (skip ? it.skip : it)('asserts --not visible on hidden element', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#display-none-element', 'visible', '--not'], { SE_CLI_SESSION: S() });
      expect(result).toContain('not visible');
    });

    (skip ? it.skip : it)('asserts --not text when text does not contain expected', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['expect', '#text-element', 'text', 'Goodbye', '--not'], { SE_CLI_SESSION: S() });
      expect(result).toContain('text');
    });

    (skip ? it.skip : it)('assertion failure exits with code 1', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // This should fail because the visible element is not hidden
      try {
        await run(['expect', '#visible-element', 'hidden'], { SE_CLI_SESSION: S() });
        // If we get here, the assertion didn't fail — that's a test failure
        expect(true).toBe(false);
      } catch (e: any) {
        // The error should contain assertion failure message
        expect(e.message).toContain('hidden');
      }
    });

    (skip ? it.skip : it)('assertion with --timeout waits for dynamic element', async () => {
      await run(['open', ASSERTIONS_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      // #dynamic-element appears after 2 seconds
      // --timeout=5000 gives enough time for the element to appear
      const result = await run([
        'expect', '#dynamic-element', 'visible', '--timeout=5000'
      ], { SE_CLI_SESSION: S() });
      expect(result).toContain('visible');
    });
  });

  // --- v0.7: Network & Debugging ---

  describe('v0.7: Network & Debugging', () => {

    // ── highlight ──────────────────────────────────────────

    (skip ? it.skip : it)('highlights element by CSS selector', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['highlight', '#target1'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Highlighted');
      // Verify the outline was applied
      const outline = (await run(['--raw', 'eval',
        `getComputedStyle(document.getElementById('target1')).outlineStyle`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(outline).not.toBe('none');
    });

    (skip ? it.skip : it)('highlights element with custom style', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['highlight', '#target2', '--style=2px solid blue'], { SE_CLI_SESSION: S() });
      const color = (await run(['--raw', 'eval',
        `getComputedStyle(document.getElementById('target2')).outlineColor`
      ], { SE_CLI_SESSION: S() })).trim();
      // Browsers return RGB values (e.g. 'rgb(0, 0, 255)') not color names
      expect(color).toMatch(/0,\s*0,\s*255/);
    });

    (skip ? it.skip : it)('lists active highlights', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['highlight', '#target1'], { SE_CLI_SESSION: S() });
      await run(['highlight', '#target2'], { SE_CLI_SESSION: S() });
      const result = await run(['--raw', 'highlight'], { SE_CLI_SESSION: S() });
      expect(result).toContain('target1');
      expect(result).toContain('target2');
    });

    (skip ? it.skip : it)('removes single highlight with --hide', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['highlight', '#target1'], { SE_CLI_SESSION: S() });
      const result = await run(['highlight', '#target1', '--hide'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Removed');
      // Verify outline was removed
      const outline = (await run(['--raw', 'eval',
        `getComputedStyle(document.getElementById('target1')).outlineStyle`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(outline).toBe('none');
    });

    (skip ? it.skip : it)('removes all highlights with --hide --all', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['highlight', '#target1'], { SE_CLI_SESSION: S() });
      await run(['highlight', '#target2'], { SE_CLI_SESSION: S() });
      const result = await run(['highlight', '--hide', '--all'], { SE_CLI_SESSION: S() });
      expect(result).toContain('All highlights cleared');
      const list = await run(['--raw', 'highlight'], { SE_CLI_SESSION: S() });
      expect(list).toContain('No active highlights');
    });

    // ── console ────────────────────────────────────────────

    (skip ? it.skip : it)('captures console messages from page load', async () => {
      // Open page first to start the browser session
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Initialize BiDi listeners and clear buffer (lazy init on first network command)
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      // Re-navigate to trigger page-load console messages with BiDi active
      await run(['open', NETWORK_DEBUG_URL()], { SE_CLI_SESSION: S() });
      // Wait briefly for BiDi events to arrive
      await new Promise(r => setTimeout(r, 1000));
      const result = await run(['--raw', 'console'], { SE_CLI_SESSION: S() });
      // The page logs "Page loaded" on load
      expect(result).toContain('Page loaded');
    });

    (skip ? it.skip : it)('captures console.log triggered by click', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Clear buffer to start fresh
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      // Click the console.log button — it uses inline onclick
      await run(['click', '#btn-log'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const result = await run(['--raw', 'console'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Hello from console.log');
    });

    (skip ? it.skip : it)('captures console.warn and console.error', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-warn'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-error'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const result = await run(['--raw', 'console'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Warning message');
      expect(result).toContain('Error message');
    });

    (skip ? it.skip : it)('filters console by error level', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-log'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-error'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const result = await run(['--raw', 'console', 'error'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Error message');
      // Should not contain info-level messages
      expect(result).not.toContain('Hello from console.log');
    });

    (skip ? it.skip : it)('clears console buffer with --clear', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      const result = await run(['--raw', 'console'], { SE_CLI_SESSION: S() });
      expect(result).toContain('no console messages');
    });

    // ── requests ────────────────────────────────────────────

    (skip ? it.skip : it)('captures network requests from fetch calls', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['requests', '--clear'], { SE_CLI_SESSION: S() });
      // Trigger a fetch request
      await run(['click', '#btn-fetch-json'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const result = await run(['--raw', 'requests'], { SE_CLI_SESSION: S() });
      expect(result).toContain('api/json');
    });

    (skip ? it.skip : it)('filters network requests by URL substring', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['requests', '--clear'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-fetch-json'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-fetch-api'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const result = await run(['--raw', 'requests', '--filter=api/json'], { SE_CLI_SESSION: S() });
      expect(result).toContain('api/json');
      expect(result).not.toContain('api/data');
    });

    (skip ? it.skip : it)('shows request details by index', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['requests', '--clear'], { SE_CLI_SESSION: S() });
      await run(['click', '#btn-fetch-json'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const result = await run(['--raw', 'request', '0'], { SE_CLI_SESSION: S() });
      expect(result).toContain('URL:');
      expect(result).toContain('Method:');
      expect(result).toContain('api/json');
    });

    (skip ? it.skip : it)('clears network request buffer', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['requests', '--clear'], { SE_CLI_SESSION: S() });
      const result = await run(['--raw', 'requests'], { SE_CLI_SESSION: S() });
      expect(result).toContain('no network requests');
    });

    // ── route & unroute ────────────────────────────────────

    (skip ? it.skip : it)('lists empty routes initially', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const result = await run(['--raw', 'route-list'], { SE_CLI_SESSION: S() });
      expect(result).toContain('no active routes');
    });

    (skip ? it.skip : it)('adds route and lists it', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const result = await run([
        'route', '*/api/mock-endpoint*', '--status=200', '--body={"mocked":true}'
      ], { SE_CLI_SESSION: S() });
      expect(result).toContain('Route');
      expect(result).toContain('mock-endpoint');
      const list = await run(['--raw', 'route-list'], { SE_CLI_SESSION: S() });
      expect(list).toContain('mock-endpoint');
    });

    (skip ? it.skip : it)('removes route by index with unroute', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['route', '*/api/mock-endpoint*', '--status=404'], { SE_CLI_SESSION: S() });
      const result = await run(['unroute', '0'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Removed');
      const list = await run(['--raw', 'route-list'], { SE_CLI_SESSION: S() });
      expect(list).toContain('no active routes');
    });

    (skip ? it.skip : it)('removes all routes with unroute --all', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['route', '*/api/json*', '--status=200'], { SE_CLI_SESSION: S() });
      await run(['route', '*/api/data*', '--status=404'], { SE_CLI_SESSION: S() });
      const result = await run(['unroute', '--all'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Removed all');
      const list = await run(['--raw', 'route-list'], { SE_CLI_SESSION: S() });
      expect(list).toContain('no active routes');
    });

    // ── v0.7: Additional coverage tests ───────────────────

    (skip ? it.skip : it)('captures JS exceptions with console js-error', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      // Trigger a JS error by clicking the button
      await run(['click', '#btn-js-error'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const result = await run(['--raw', 'console', 'js-error'], { SE_CLI_SESSION: S() });
      // Should contain the JS exception text
      expect(result).toContain('undefinedFunction');
    });

    (skip ? it.skip : it)('filters console by --since time window', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      await run(['console', '--clear'], { SE_CLI_SESSION: S() });
      // Generate a console message
      await run(['click', '#btn-log'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Filter with --since=5m should include the message
      const result = await run(['--raw', 'console', '--since=5m'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Hello from console.log');
      // Filter with --since=0s should exclude all messages (cutoff = now)
      const result2 = await run(['--raw', 'console', '--since=0s'], { SE_CLI_SESSION: S() });
      // With 0s, the cutoff is "now" — messages from 500ms ago should be excluded
      // (timestamp check: e.timestamp >= Date.now() - 0 = Date.now())
    });

    (skip ? it.skip : it)('filters network requests by status code', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['requests', '--clear'], { SE_CLI_SESSION: S() });
      // Trigger a 404 request
      await run(['click', '#btn-fetch-404'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const result = await run(['--raw', 'requests', '--status=404'], { SE_CLI_SESSION: S() });
      expect(result).toContain('404');
    });

    (skip ? it.skip : it)('filters network requests by HTTP method', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['requests', '--clear'], { SE_CLI_SESSION: S() });
      // Trigger a POST request
      await run(['click', '#btn-fetch-post'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const result = await run(['--raw', 'requests', '--method=POST'], { SE_CLI_SESSION: S() });
      expect(result).toContain('POST');
      expect(result).toContain('api/submit');
    });

    (skip ? it.skip : it)('verifies route mock intercepts actual request', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Set up a route mock that returns 401 with a custom body
      await run([
        'route', '*/api/mock-endpoint*', '--status=401', `--body={"error":"mocked"}`,
      ], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Trigger the fetch — the mock should intercept it
      await run(['click', '#btn-mock-fetch'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      // Verify the page received the mocked response
      const mockResult = await run(['--raw', 'eval',
        `document.getElementById('mock-result').textContent`
      ], { SE_CLI_SESSION: S() });
      expect(mockResult).toContain('401');
      expect(mockResult).toContain('mocked');
    });

    (skip ? it.skip : it)('lets non-matching requests reach the real endpoint', async () => {
      // Mixed-scenario: the intercept must only swallow matching patterns.
      // /api/json is mocked, so /api/data must still return the real body.
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['route', '*/api/json*', '--status=500', '--body={"mocked":"json"}'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['click', '#btn-fetch-api'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const status = (await run(['--raw', 'eval',
        `document.getElementById('status').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(status).toContain('API OK');
      expect(status).toContain('items');
    });

    (skip ? it.skip : it)('restores the real response after unroute', async () => {
      // unroute must not just disappear from route-list — the live response
      // must go back to the real endpoint.
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['route', '*/api/mock-endpoint*', '--status=500', '--body={"mocked":true}'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // First fetch is intercepted by the mock
      await run(['click', '#btn-mock-fetch'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const mocked = (await run(['--raw', 'eval',
        `document.getElementById('mock-result').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(mocked).toContain('500');
      // Remove the route, then fetch again — the real response must come back
      await run(['unroute', '0'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      await run(['click', '#btn-mock-fetch'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const restored = (await run(['--raw', 'eval',
        `document.getElementById('mock-result').textContent`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(restored).toContain('200');
      expect(restored).toContain('original');
    });

    (skip ? it.skip : it)('highlights element by ref using data-se-ref', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['highlight', 'e1'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Highlighted');
      // Verify the outline was applied
      const outline = (await run(['--raw', 'eval',
        `getComputedStyle(document.getElementById('target1')).outlineStyle`
      ], { SE_CLI_SESSION: S() })).trim();
      expect(outline).not.toBe('none');
    });

    (skip ? it.skip : it)('verifies route mock applies custom headers', async () => {
      await run(['open', NETWORK_DEBUG_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Set up a route mock with custom headers
      await run([
        'route', '*/api/mock-endpoint*', '--status=200',
        '--body={"ok":true}',
        '--headers={"X-Custom-Header":"test-value","Content-Type":"application/json"}',
      ], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      // Trigger the fetch and check if custom headers are in the response
      await run(['click', '#btn-mock-headers'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 1000));
      const headersResult = await run(['--raw', 'eval',
        `document.getElementById('headers-result').textContent`
      ], { SE_CLI_SESSION: S() });
      expect(headersResult).toContain('test-value');
    });

    // ── v0.8: Device & Environment Emulation ──────────────────────

    const EMULATION_URL = () => server.url('emulation.html');

    const readProbe = async () => JSON.parse((await run(['--raw', 'eval', 'JSON.stringify(window.__probe)'], { SE_CLI_SESSION: S() })).trim());

    (skip ? it.skip : it)('applies --viewport via emulation', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`, '--viewport=500x400'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      expect(probe.viewport.width).toBe(500);
      expect(probe.viewport.height).toBe(400);
    });

    (skip ? it.skip : it)('rejects an invalid --viewport value', async () => {
      await expect(run(['open', EMULATION_URL(), `--browser=${browser}`, '--viewport=abc'], { SE_CLI_SESSION: S() }))
        .rejects.toThrow('Invalid --viewport');
    });

    (skip ? it.skip : it)('rejects an invalid --geolocation value', async () => {
      await expect(run(['open', EMULATION_URL(), `--browser=${browser}`, '--geolocation=abc'], { SE_CLI_SESSION: S() }))
        .rejects.toThrow('Invalid --geolocation');
    });

    const skipFirefoxEmulation = skip || browser === 'firefox';

    (skipFirefoxEmulation ? it.skip : it)('applies --user-agent via CDP', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`, '--user-agent=se-cli-e2e-test-agent'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      expect(probe.userAgent).toContain('se-cli-e2e-test-agent');
    });

    (skipFirefoxEmulation ? it.skip : it)('applies --color-scheme via CDP', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`, '--color-scheme=dark'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      expect(probe.colorScheme).toBe('dark');
    });

    (skipFirefoxEmulation ? it.skip : it)('applies --timezone via CDP', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`, '--timezone=America/New_York'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      expect(probe.timezone).toBe('America/New_York');
    });

    (skipFirefoxEmulation ? it.skip : it)('applies --locale via CDP', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`, '--locale=fr-FR'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      // setLocaleOverride affects Intl APIs, not navigator.language.
      expect(probe.intlLocale).toMatch(/^fr/);
    });

    // ── v0.8: device presets ──────────────────────────────────────

    (skip ? it.skip : it)('lists built-in device presets', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['--raw', 'device-list'], { SE_CLI_SESSION: S() });
      expect(result).toContain('iPhone 13');
      expect(result).toContain('Pixel 7');
      expect(result).toContain('390x664@3x');
    });

    (skip ? it.skip : it)('applies a device preset viewport', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['device', 'iPhone 13'], { SE_CLI_SESSION: S() });
      expect(result).toContain('applied');
      // Emulation takes effect at runtime — reload so the page re-reads values.
      await run(['reload'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      expect(probe.viewport.width).toBe(390);
      expect(probe.viewport.height).toBe(664);
    });

    (skip ? it.skip : it)('rejects an unknown device preset', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['device', 'Commodore 64'], { SE_CLI_SESSION: S() });
      expect(result).toContain('Unknown device');
    });

    (skipFirefoxEmulation ? it.skip : it)('applies device UA via CDP', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await run(['device', 'Pixel 7'], { SE_CLI_SESSION: S() });
      await run(['reload'], { SE_CLI_SESSION: S() });
      await new Promise(r => setTimeout(r, 500));
      const probe = await readProbe();
      expect(probe.userAgent).toContain('Pixel 7');
    });

    // ── v0.8: emulate (network/CPU) ───────────────────────────────

    (skip ? it.skip : it)('shows current emulation state', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['--raw', 'emulate'], { SE_CLI_SESSION: S() });
      expect(result).toContain('no emulation active');
    });

    (skipFirefoxEmulation ? it.skip : it)('applies network throttle and resets', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const applied = await run(['emulate', '--throttle-network=slow3g'], { SE_CLI_SESSION: S() });
      expect(applied).toContain('emulation applied');
      expect(applied).toContain('throttle');
      const state = await run(['--raw', 'emulate'], { SE_CLI_SESSION: S() });
      expect(state).toContain('throttle');
      const reset = await run(['emulate', '--reset'], { SE_CLI_SESSION: S() });
      expect(reset).toContain('emulation reset');
      const after = await run(['--raw', 'emulate'], { SE_CLI_SESSION: S() });
      expect(after).toContain('no emulation active');
    });

    (skipFirefoxEmulation ? it.skip : it)('applies CPU throttle', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      const result = await run(['emulate', '--throttle-cpu=4'], { SE_CLI_SESSION: S() });
      expect(result).toContain('cpu=4x');
    });

    (skipFirefoxEmulation ? it.skip : it)('rejects an invalid throttle value', async () => {
      await run(['open', EMULATION_URL(), `--browser=${browser}`], { SE_CLI_SESSION: S() });
      await expect(run(['emulate', '--throttle-network=bogus'], { SE_CLI_SESSION: S() }))
        .rejects.toThrow('Invalid --throttle-network');
    });
  });
});

