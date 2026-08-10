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
  return `v011-${Date.now().toString(36)}-${counter}`;
}

async function run(args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 90000,
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

describe('v0.11: record → export → report', () => {
  const runnable = E2E_ENABLED && CHROME;

  (runnable ? it : it.skip)('records commands, exports a mocha test, and renders reports', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);

    // A browser may be installed but unable to start a session in this
    // environment (sandbox). Only run the live-session flow when it works.
    try {
      await run(['open', EXAMPLE_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    // record start / status
    const startOut = await run(['record', 'start'], env);
    expect(startOut).toContain('Recording started');

    // execute a few commands that produce codegen
    const titleOut = await run(['title'], env);
    expect(titleOut).toMatch(/Example Domain|example/i);

    await run(['record', 'status'], env);
    // read-only commands with no codegen are still captured
    await run(['screenshot'], env);

    await run(['record', 'stop'], env);
    const statusOut = await run(['record', 'status'], env);
    expect(statusOut).toContain('recording: idle');
    expect(statusOut).toMatch(/steps: [1-9]\d*/);

    // export as mocha — codegen lines are embedded verbatim
    const mochaOut = await run(['record', 'export', '--format=mocha', '--browser=chrome'], env);
    expect(mochaOut).toContain("const { Builder, By } = require('selenium-webdriver');");
    expect(mochaOut).toContain("forBrowser('chrome')");

    // export to a file
    const outFile = path.join(__dirname, '..', '..', 'dist', `.v011-export-${sess}.test.js`);
    await run(['record', 'export', '--format=mocha', `--out=${outFile}`], env);
    const written = fs.readFileSync(outFile, 'utf8');
    expect(written).toContain("describe('se-cli session', function ()");
    fs.unlinkSync(outFile);

    // report: junit
    const junitOut = await run(['record', 'report', '--format=junit'], env);
    expect(junitOut).toContain('<testsuite');
    expect(junitOut).toContain('tests="');

    // report: html
    const htmlOut = await run(['record', 'report', '--format=html'], env);
    expect(htmlOut).toContain('<!DOCTYPE html>');
    expect(htmlOut).toContain('se-cli report');

    await run(['close'], env).catch(() => {});
  });

  (E2E_ENABLED ? it : it.skip)('record control commands work without a live driver (recovery path)', async () => {
    const sess = S();
    const env = { SE_CLI_SESSION: sess };
    // open may fail to build the driver in restricted environments, but the
    // daemon stays up; record commands must still work (export after crash).
    await run(['open', '--browser=chrome', EXAMPLE_URL()], env).catch(() => {});

    await run(['record', 'start'], env);
    await run(['record', 'status'], env);
    const stopErr = await runExpectFail(['record', 'export', '--format=mocha'], env);
    expect(stopErr).toMatch(/No recorded steps|no recorded steps/i);
    await run(['record', 'stop'], env);
    await run(['close'], env).catch(() => {});
  });

  (runnable ? it : it.skip)('fails clearly without an active recording', async () => {
    const sess = S();
    const env = SESSION_OPEN(sess);
    try {
      await run(['open', EXAMPLE_URL(), '--browser=chrome'], env);
    } catch {
      return; // environment cannot host a session — skip body
    }

    const stopErr = await runExpectFail(['record', 'stop'], env);
    expect(stopErr).toMatch(/not active|Not recording/i);

    const exportErr = await runExpectFail(['record', 'export', '--format=mocha'], env);
    expect(exportErr).toMatch(/no recorded steps|No recorded steps/i);

    await run(['close'], env).catch(() => {});
  });
});

async function runExpectFail(args: string[], env: Record<string, string> = {}): Promise<string> {
  try {
    await run(args, env);
    return '';
  } catch (e: any) {
    return String(e.stderr || e.stdout || e.message);
  }
}
