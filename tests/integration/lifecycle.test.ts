import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');

function run(args: string[]): string {
  return execSync(`node ${CLI} ${args.join(' ')}`, { encoding: 'utf8', timeout: 60000 });
}

describe('lifecycle (requires Chrome installed)', () => {
  afterEach(() => {
    try { run(['close']); } catch {}
  });

  it.skipIf(!process.env.SELENIUM_CLI_E2E)('opens, navigates, gets title, closes', () => {
    run(['open', 'https://example.com']);
    const title = run(['--raw', 'title']).trim();
    expect(title).toBe('Example Domain');
  });

  it.skipIf(!process.env.SELENIUM_CLI_E2E)('takes a snapshot with refs', () => {
    run(['open', 'https://example.com']);
    const snapshot = run(['--raw', 'snapshot']);
    expect(snapshot).toContain('link');
    expect(snapshot).toMatch(/ref=e\d+/);
  });
});
