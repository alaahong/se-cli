import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');

function run(args: string[], env?: Record<string, string>): string {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ...env },
    shell: false,
  });
}

const BROWSERS = ['chrome', 'edge', 'firefox'];

// Direct TodoMVC React implementation URL — avoids redirect from the
// framework selection page which doesn't always resolve consistently.
const TODOMVC_URL = 'https://demo.playwright.dev/todomvc/dist/react/';

describe.each(BROWSERS)('lifecycle with %s', (browser) => {
  const skip = !process.env.SE_CLI_E2E || !process.env[`SE_CLI_TEST_${browser.toUpperCase()}`];

  beforeEach(() => {
    if (skip) return;
    try { run(['close'], { SE_CLI_SESSION: `test-${browser}` }); } catch {}
  });

  afterEach(() => {
    if (skip) return;
    try { run(['close'], { SE_CLI_SESSION: `test-${browser}` }); } catch {}
  });

  (skip ? it.skip : it)('opens browser and closes', () => {
    run(['open', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const title = run(['--raw', 'title'], { SE_CLI_SESSION: `test-${browser}` }).trim();
    expect(title).toBeDefined();
  });

  (skip ? it.skip : it)('navigates to URL', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const title = run(['--raw', 'title'], { SE_CLI_SESSION: `test-${browser}` }).trim();
    expect(title).toBe('Example Domain');
    const url = run(['--raw', 'url'], { SE_CLI_SESSION: `test-${browser}` }).trim();
    expect(url).toContain('example.com');
  });

  (skip ? it.skip : it)('takes snapshot with refs', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const snapshot = run(['--raw', 'snapshot'], { SE_CLI_SESSION: `test-${browser}` });
    expect(snapshot).toContain('link');
    expect(snapshot).toMatch(/ref=e\d+/);
  });

  (skip ? it.skip : it)('navigates back/forward/reload', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    run(['goto', 'https://www.iana.org/domains/reserved'], { SE_CLI_SESSION: `test-${browser}` });
    const title1 = run(['--raw', 'title'], { SE_CLI_SESSION: `test-${browser}` }).trim();
    run(['go-back'], { SE_CLI_SESSION: `test-${browser}` });
    const title2 = run(['--raw', 'title'], { SE_CLI_SESSION: `test-${browser}` }).trim();
    expect(title2).toBe('Example Domain');
    run(['go-forward'], { SE_CLI_SESSION: `test-${browser}` });
    run(['reload'], { SE_CLI_SESSION: `test-${browser}` });
  });

  (skip ? it.skip : it)('clicks element by ref', () => {
    run(['open', TODOMVC_URL, `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const snapshot = run(['--raw', 'snapshot'], { SE_CLI_SESSION: `test-${browser}` });
    // Look for a textbox ref specifically — the first ref might be a link or other element.
    const refMatch = snapshot.match(/textbox[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    run(['fill', ref, 'Buy groceries'], { SE_CLI_SESSION: `test-${browser}` });
    run(['press', 'Enter'], { SE_CLI_SESSION: `test-${browser}` });
    const after = run(['--raw', 'snapshot'], { SE_CLI_SESSION: `test-${browser}` });
    expect(after).toContain('Buy groceries');
  });

  (skip ? it.skip : it)('takes screenshot', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const result = run(['screenshot', '--filename=test.png'], { SE_CLI_SESSION: `test-${browser}` });
    expect(result).toContain('test.png');
    const file = path.join(process.cwd(), '.se-cli', 'test.png');
    expect(fs.existsSync(file)).toBe(true);
    fs.unlinkSync(file);
  });

  (skip ? it.skip : it)('evaluates JavaScript', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const result = run(['--raw', 'eval', 'document.title'], { SE_CLI_SESSION: `test-${browser}` }).trim();
    expect(result).toBe('Example Domain');
  });

  (skip ? it.skip : it)('finds text in snapshot', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const result = run(['--raw', 'find', 'More information'], { SE_CLI_SESSION: `test-${browser}` });
    expect(result).toContain('More information');
  });

  (skip ? it.skip : it)('lists sessions', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const result = run(['list']);
    expect(result).toContain(`test-${browser}`);
  });

  (skip ? it.skip : it)('json output mode', () => {
    run(['open', 'https://example.com', `--browser=${browser}`], { SE_CLI_SESSION: `test-${browser}` });
    const result = run(['--json', 'title'], { SE_CLI_SESSION: `test-${browser}` });
    const parsed = JSON.parse(result);
    expect(parsed.result).toBe('Example Domain');
  });
});
