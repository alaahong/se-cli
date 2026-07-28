import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findWorkspaceDir, main } from '../../src/program';

describe('findWorkspaceDir', () => {
  it('returns cwd when no .selenium-cli dir is found', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-ws-'));
    try {
      const result = findWorkspaceDir(tmp);
      expect(result).toBe(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('finds .selenium-cli in the current directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-ws-'));
    try {
      fs.mkdirSync(path.join(tmp, '.selenium-cli'));
      const result = findWorkspaceDir(tmp);
      expect(result).toBe(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('finds .selenium-cli in a parent directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-ws-'));
    try {
      fs.mkdirSync(path.join(tmp, '.selenium-cli'));
      const child = path.join(tmp, 'sub', 'deep');
      fs.mkdirSync(child, { recursive: true });
      const result = findWorkspaceDir(child);
      expect(result).toBe(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns cwd when no .selenium-cli found after 10 levels up', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-ws-'));
    try {
      // Build a deeply nested path. findWorkspaceDir stops after 10 iterations
      // and returns cwd. Even if it walks up, on most systems it will hit root.
      const deep = path.join(tmp, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k');
      fs.mkdirSync(deep, { recursive: true });
      const result = findWorkspaceDir(deep);
      // Either returns deep (cwd) or a parent that contains .selenium-cli, but
      // we created none, so it must equal deep.
      expect(result).toBe(deep);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('main command routing', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalCwd: string;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    originalCwd = process.cwd();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrSpy.mockRestore();
    exitSpy.mockRestore();
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it('prints help and exits when --help flag is passed', async () => {
    await expect(main(['--help'])).rejects.toThrow('process.exit called');
    expect(consoleLogSpy).toHaveBeenCalled();
    const helpText = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
    expect(helpText).toContain('selenium-cli');
    expect(helpText).toContain('Usage');
  });

  it('prints help and exits when no args are passed', async () => {
    await expect(main([])).rejects.toThrow('process.exit called');
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('open command calls session.startDaemon and forwards goto', async () => {
    const sessionModule = await import('../../src/session');
    const startDaemonSpy = vi.spyOn(sessionModule.Session.prototype, 'startDaemon').mockResolvedValue(undefined);
    const runSpy = vi.spyOn(sessionModule.Session.prototype, 'run').mockResolvedValue({
      ok: true,
      text: 'navigated',
    });
    const outputModule = await import('../../src/output');
    const renderSpy = vi.spyOn(outputModule, 'render').mockImplementation(() => {});

    await main(['open', 'https://example.com', '--browser=chrome']);

    expect(startDaemonSpy).toHaveBeenCalledWith(expect.objectContaining({ browserName: 'chrome' }));
    expect(runSpy).toHaveBeenCalledWith(['goto', 'https://example.com'], originalCwd, expect.any(Object));
    expect(renderSpy).toHaveBeenCalled();

    startDaemonSpy.mockRestore();
    runSpy.mockRestore();
    renderSpy.mockRestore();
  });

  it('open command without url does not call run', async () => {
    const sessionModule = await import('../../src/session');
    const startDaemonSpy = vi.spyOn(sessionModule.Session.prototype, 'startDaemon').mockResolvedValue(undefined);
    const runSpy = vi.spyOn(sessionModule.Session.prototype, 'run').mockResolvedValue({ ok: true, text: '' });

    await main(['open', '--browser=edge', '--headed']);

    expect(startDaemonSpy).toHaveBeenCalledWith(expect.objectContaining({ browserName: 'edge', headed: true }));
    expect(runSpy).not.toHaveBeenCalled();

    startDaemonSpy.mockRestore();
    runSpy.mockRestore();
  });

  it('close command calls session.stop', async () => {
    const sessionModule = await import('../../src/session');
    const stopSpy = vi.spyOn(sessionModule.Session.prototype, 'stop').mockResolvedValue(undefined);

    await main(['close']);

    expect(stopSpy).toHaveBeenCalled();

    stopSpy.mockRestore();
  });

  it('list command calls registry.listSessions and prints sessions', async () => {
    const sessionModule = await import('../../src/session');
    const canConnectSpy = vi.spyOn(sessionModule.Session.prototype, 'canConnect').mockResolvedValue(true);

    // Use a tmp registry dir by setting LOCALAPPDATA to a tmp path
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-list-'));
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tmpBase;
    try {
      // Pre-create a session file via the Registry
      const { Registry } = await import('../../src/registry');
      const { workspaceHash } = await import('../../src/config');
      const reg = new Registry(path.join(tmpBase, 'ms-selenium-cli', 'daemon'));
      const wsHash = workspaceHash(originalCwd);
      reg.writeSession(wsHash, {
        name: 'list-test',
        version: '0.1.0',
        timestamp: Date.now(),
        socketPath: '/tmp/sock',
        workspaceDir: originalCwd,
        persistent: false,
        browserName: 'chrome',
      });

      await main(['list']);

      expect(canConnectSpy).toHaveBeenCalled();
      const out = consoleLogSpy.mock.calls.map(c => c[0]).join('\n');
      expect(out).toContain('list-test');
      expect(out).toContain('chrome');
    } finally {
      process.env.LOCALAPPDATA = prev;
      fs.rmSync(tmpBase, { recursive: true, force: true });
      canConnectSpy.mockRestore();
    }
  });

  it('close-all command stops all sessions', async () => {
    const sessionModule = await import('../../src/session');
    const stopSpy = vi.spyOn(sessionModule.Session.prototype, 'stop').mockResolvedValue(undefined);

    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-closeall-'));
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tmpBase;
    try {
      const { Registry } = await import('../../src/registry');
      const { workspaceHash } = await import('../../src/config');
      const reg = new Registry(path.join(tmpBase, 'ms-selenium-cli', 'daemon'));
      const wsHash = workspaceHash(originalCwd);
      reg.writeSession(wsHash, {
        name: 'ca-test1',
        version: '0.1.0',
        timestamp: Date.now(),
        socketPath: '/tmp/sock1',
        workspaceDir: originalCwd,
        persistent: false,
        browserName: 'chrome',
      });
      reg.writeSession(wsHash, {
        name: 'ca-test2',
        version: '0.1.0',
        timestamp: Date.now(),
        socketPath: '/tmp/sock2',
        workspaceDir: originalCwd,
        persistent: false,
        browserName: 'edge',
      });

      await main(['close-all']);

      expect(stopSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.env.LOCALAPPDATA = prev;
      fs.rmSync(tmpBase, { recursive: true, force: true });
      stopSpy.mockRestore();
    }
  });
});
