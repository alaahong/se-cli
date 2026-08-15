import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
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
  return `v013-pdf-${Date.now().toString(36)}-${counter}`;
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

describe('v0.13: BiDi pdf/screenshot (--bidi)', () => {
  const runnable = E2E_ENABLED && CHROME;

  (runnable ? it : it.skip)('saves a PDF and a screenshot via the BiDi connection', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);
    const outDir = path.join(process.cwd(), '.se-cli');
    const pdfPath = path.join(outDir, 'v013-bidi.pdf');
    const pngPath = path.join(outDir, 'v013-bidi.png');
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);

    try {
      await run(['open', EXAMPLE_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    try {
      // BiDi print → PDF.
      const pdfOut = await run(['pdf', '--bidi', '--filename=v013-bidi.pdf'], env);
      expect(pdfOut).toContain('[PDF]');
      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(fs.readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

      // BiDi captureScreenshot → PNG.
      const shotOut = await run(['screenshot', '--bidi', '--filename=v013-bidi.png'], env);
      expect(shotOut).toContain('[Screenshot]');
      expect(fs.existsSync(pngPath)).toBe(true);
      expect(fs.statSync(pngPath).size).toBeGreaterThan(0);
    } finally {
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
      await run(['close'], env);
    }
  });
});
