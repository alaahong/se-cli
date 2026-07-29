import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { startTestServer, type TestServer } from './test-server';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');

async function run(args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ...env },
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

const BROWSERS = ['chrome', 'edge', 'firefox'];

// HTTP test server — started once for all browser suites.
// Supports static fixture files and extensible dynamic routes.
let server: TestServer;

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

describe.each(BROWSERS)('lifecycle with %s', (browser) => {
  const skip = !process.env.SE_CLI_E2E || !process.env[`SE_CLI_TEST_${browser.toUpperCase()}`];
  const S = () => `test-${browser}`;

  beforeEach(async () => {
    if (skip) return;
    try { await run(['close'], { SE_CLI_SESSION: S() }); } catch {}
  });

  afterEach(async () => {
    if (skip) return;
    try { await run(['close'], { SE_CLI_SESSION: S() }); } catch {}
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
});
