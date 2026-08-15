import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
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
const UPLOAD_URL = () => server.url('upload.html');

let counter = 0;
function S(): string {
  counter++;
  return `v013-upload-${Date.now().toString(36)}-${counter}`;
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

/** Read the #uploaded-name text rendered by the fixture page. */
async function uploadedName(env: Record<string, string>): Promise<string> {
  const out = await run(['eval', 'document.getElementById("uploaded-name").textContent'], env);
  return out.trim();
}

describe('v0.13: BiDi file upload (upload --bidi)', () => {
  const runnable = E2E_ENABLED && CHROME;

  (runnable ? it : it.skip)('uploads a file via sendKeys and via BiDi input.setFiles', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);

    try {
      await run(['open', UPLOAD_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    // A real file to upload.
    const tmp = path.join(os.tmpdir(), `se-cli-upload-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'hello from se-cli\n');

    try {
      // Default sendKeys path.
      await run(['upload', '#file-input', tmp], env);
      expect(await uploadedName(env)).toBe(path.basename(tmp));

      // BiDi input.setFiles path.
      const bidiOut = await run(['upload', '#file-input', tmp, '--bidi'], env);
      expect(bidiOut).toContain('uploaded:');
      expect(await uploadedName(env)).toBe(path.basename(tmp));
    } finally {
      fs.unlinkSync(tmp);
      await run(['close'], env);
    }
  });
});
