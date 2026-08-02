/**
 * Coverage tests for the `se-cli logs` command in src/program.ts.
 *
 * The command tails this session's daemon + CLI log files under
 * %LOCALAPPDATA%/ms-se-cli/daemon/logs. config is mocked to point at a
 * per-run temp directory so tests never touch the real base dir.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const state = vi.hoisted(() => ({
  tmpDir: '',
}));

vi.mock('../../src/config', () => ({
  baseDaemonDir: () => state.tmpDir,
  workspaceHash: () => 'mockhash',
  makeSocketPath: () => '/tmp/mock.sock',
  userHash: () => 'mockuser',
  defaultSessionName: 'default',
  sessionFileDir: () => state.tmpDir,
  sessionFilePath: () => path.join(state.tmpDir, 'default.session'),
  outputDir: () => state.tmpDir,
}));

vi.mock('../../src/session', () => {
  const instance = {
    startDaemon: vi.fn(async () => {}),
    run: vi.fn(async () => ({ ok: true, text: 'success' })),
    stop: vi.fn(async () => {}),
    canConnect: vi.fn(async () => true),
    loadConfig: vi.fn(() => null),
  };
  return { Session: vi.fn(() => instance), _mockInstance: instance };
});

vi.mock('../../src/registry', () => ({
  Registry: vi.fn(() => ({
    loadSession: vi.fn(() => null),
    writeSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(() => []),
    listAllSessions: vi.fn(() => []),
  })),
}));

vi.mock('../../src/output', () => ({ render: vi.fn() }));

vi.mock('../../src/wait-config', () => ({
  loadConfigFile: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  listConfig: vi.fn(() => []),
  generateTemplateConfig: vi.fn(),
  resolveConfig: vi.fn(() => ({
    wait: { state: 'none', timeout: 0, retry: 0, retryInterval: 100 },
    timeouts: { implicit: 0, pageLoad: 30000, script: 30000 },
    sources: {},
  })),
  applyTimeouts: vi.fn(),
  waitForElementState: vi.fn(),
  DEFAULTS: {
    wait: { timeout: 5000, state: 'auto', retry: 0, retryInterval: 100 },
    timeouts: { implicit: 0, pageLoad: 30000, script: 30000 },
    perCommand: {},
  },
}));

import { main } from '../../src/program';

describe('se-cli logs command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const daemonLog = () => path.join(state.tmpDir, 'logs', 'mockhash-default.daemon.log');
  const cliLog = () => path.join(state.tmpDir, 'logs', 'mockhash-default.cli.log');

  function output(): string {
    return consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  }

  beforeAll(() => {
    state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selogs-cmd-'));
    fs.mkdirSync(path.join(state.tmpDir, 'logs'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(state.tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    try { fs.unlinkSync(daemonLog()); } catch {}
    try { fs.unlinkSync(cliLog()); } catch {}
    vi.restoreAllMocks();
  });

  function writeLines(fp: string, n: number): void {
    const lines: string[] = [];
    for (let i = 1; i <= n; i++) lines.push(`2026-08-01T00:00:00.000Z [INFO] [test] line ${i}`);
    fs.writeFileSync(fp, lines.join('\n') + '\n');
  }

  it('prints the daemon log tail (default 50 lines)', async () => {
    writeLines(daemonLog(), 60);
    await main(['logs']);
    const out = output();
    expect(out).toContain('--- mockhash-default.daemon.log ---');
    // First 10 lines are cut by the tail, the rest is printed in order.
    const printed = out.split('\n');
    expect(printed).not.toContain(`2026-08-01T00:00:00.000Z [INFO] [test] line 1`);
    expect(printed).not.toContain(`2026-08-01T00:00:00.000Z [INFO] [test] line 10`);
    expect(printed).toContain(`2026-08-01T00:00:00.000Z [INFO] [test] line 11`);
    expect(printed).toContain(`2026-08-01T00:00:00.000Z [INFO] [test] line 60`);
  });

  it('honors --tail=N', async () => {
    writeLines(daemonLog(), 60);
    await main(['logs', '--tail=5']);
    const out = output();
    expect(out).not.toContain('line 55');
    expect(out).toContain('line 56');
    expect(out).toContain('line 60');
  });

  it('prints both daemon and cli log files when both exist', async () => {
    writeLines(daemonLog(), 3);
    writeLines(cliLog(), 2);
    await main(['logs']);
    const out = output();
    expect(out).toContain('--- mockhash-default.daemon.log ---');
    expect(out).toContain('--- mockhash-default.cli.log ---');
    expect(out).toContain('line 3');
    expect(out).toContain('line 2');
  });

  it('prints only the cli log when the daemon log is missing', async () => {
    writeLines(cliLog(), 1);
    await main(['logs']);
    const out = output();
    expect(out).toContain('--- mockhash-default.cli.log ---');
    expect(out).not.toContain('daemon.log');
  });

  it('prints a hint when no log files exist', async () => {
    await main(['logs']);
    expect(output()).toContain('(no log files yet');
  });

  it('prints the header but no lines for an empty log file', async () => {
    fs.writeFileSync(daemonLog(), '');
    await main(['logs']);
    const out = output();
    expect(out).toContain('--- mockhash-default.daemon.log ---');
    expect(out).not.toContain('[INFO]');
  });
});
