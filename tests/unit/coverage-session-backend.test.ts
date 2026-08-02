/**
 * Coverage tests for src/session.ts and src/daemon/backend.ts.
 *
 * This file targets uncovered branches in:
 *   - Session class (canConnect, sendAndClose, run, stop, loadConfig)
 *   - callTool (config commands, unknown tool, retry logic, timeout application)
 *
 * Mocking strategy:
 *   - net module: mock sockets with manual event emitter
 *   - child_process: mock spawn
 *   - registry/config: mock to isolate Session from filesystem
 *   - wait-config: NOT mocked — real implementation used for callTool config tests
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

// ── Hoisted state shared with mock factories ──────────────────────────
// vi.hoisted runs before any import, so these values are available inside
// vi.mock factory functions.

const mockState = vi.hoisted(() => ({
  // Accumulator for all sockets created by net.connect
  sockets: [] as any[],
  // Shared registry mock instance so tests can configure return values
  registry: {
    loadSession: vi.fn(() => null),
    writeSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(() => []),
  },
}));

// ── Mock: net ─────────────────────────────────────────────────────────
// A lightweight event-emitter mock that supports on/once/emit without
// depending on Node's EventEmitter (avoids require() inside factory).

vi.mock('net', () => {
  function createMockSocket() {
    const handlers: Record<string, Array<(...args: any[]) => void>> = {};
    const sock = {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      removeAllListeners: vi.fn(() => {
        Object.keys(handlers).forEach((k) => delete handlers[k]);
      }),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(cb);
        return sock;
      }),
      once: vi.fn((event: string, cb: (...args: any[]) => void) => {
        const wrapper = (...args: any[]) => {
          const arr = handlers[event];
          if (arr) {
            const idx = arr.indexOf(wrapper);
            if (idx >= 0) arr.splice(idx, 1);
          }
          cb(...args);
        };
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(wrapper);
        return sock;
      }),
      emit: vi.fn((event: string, ...args: any[]) => {
        const arr = handlers[event];
        if (arr) [...arr].forEach((cb) => cb(...args));
      }),
    };
    return sock;
  }

  return {
    connect: vi.fn((_path: string) => {
      const sock = createMockSocket();
      mockState.sockets.push(sock);
      return sock;
    }),
    createServer: vi.fn(),
  };
});

// ── Mock: child_process ───────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdout: { on: vi.fn(), removeListener: vi.fn() },
    stderr: { on: vi.fn(), removeListener: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    unref: vi.fn(),
  })),
}));

// ── Mock: registry ────────────────────────────────────────────────────

vi.mock('../../src/registry', () => ({
  Registry: vi.fn(() => mockState.registry),
}));

// ── Mock: config ──────────────────────────────────────────────────────

vi.mock('../../src/config', () => ({
  makeSocketPath: vi.fn(() => '/tmp/mock-socket'),
  workspaceHash: vi.fn(() => 'mockhash123'),
  baseDaemonDir: vi.fn(() => '/tmp/mock-daemon'),
}));

// ── Real imports (after mocks are registered) ─────────────────────────

import { Session } from '../../src/session';
import { callTool } from '../../src/daemon/backend';
import { Response } from '../../src/response';
// Import the real wait-config module so we can register it in Node's
// require cache (see below).
import * as waitConfigModule from '../../src/wait-config';

// ── Bridge: make require('../wait-config') work inside backend.ts ─────
// backend.ts's handleConfigCommand uses a lazy require('../wait-config')
// to load config helper functions. In Vitest's Vite environment, require()
// cannot resolve TypeScript source files. We intercept Module._resolveFilename
// and pre-populate the cache so the require returns the Vite-transformed module.
import Module from 'module';

const VIRTUAL_WAIT_CONFIG = '__se_cli_virtual_wait_config__';
const _originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  this: any,
  request: string,
  parent: any,
  ...rest: any[]
) {
  if (request === '../wait-config') {
    return VIRTUAL_WAIT_CONFIG;
  }
  return _originalResolveFilename.call(this, request, parent, ...rest);
};
const _cachedModule = new (Module as any)(VIRTUAL_WAIT_CONFIG);
_cachedModule.exports = waitConfigModule;
_cachedModule.loaded = true;
(Module as any)._cache[VIRTUAL_WAIT_CONFIG] = _cachedModule;

afterAll(() => {
  (Module as any)._resolveFilename = _originalResolveFilename;
  delete (Module as any)._cache[VIRTUAL_WAIT_CONFIG];
});

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Wait until net.connect has created at least `index + 1` sockets.
 * Used in retry tests where subsequent sockets are created after
 * async retry delays.
 */
async function waitForSocket(index: number, timeout = 5000): Promise<any> {
  const start = Date.now();
  while (mockState.sockets.length <= index && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (mockState.sockets.length <= index) {
    throw new Error(
      `Socket ${index} not created within ${timeout}ms ` +
        `(only ${mockState.sockets.length} socket(s) created)`,
    );
  }
  return mockState.sockets[index];
}

/**
 * Build a mock WebDriver with all methods needed by callTool and the
 * browser_title handler.
 */
function makeMockDriver() {
  const defaultContent = vi.fn(async () => {});
  const switchTo = vi.fn(() => ({ defaultContent }));
  const timeouts = {
    implicitWait: vi.fn(async (_ms: number) => {}),
    pageLoadTimeout: vi.fn(async (_ms: number) => {}),
    setScriptTimeout: vi.fn(async (_ms: number) => {}),
  };
  const manage = vi.fn(() => ({ timeouts: vi.fn(() => timeouts) }));
  return {
    getTitle: vi.fn(async () => 'Test Title'),
    getCurrentUrl: vi.fn(async () => 'https://example.com'),
    switchTo,
    manage,
    _timeouts: timeouts,
    _defaultContent: defaultContent,
  };
}

/** Create a temp directory, optionally writing a .se-cli.json config file. */
function makeTempDir(config?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-cov-'));
  if (config) {
    fs.writeFileSync(
      path.join(dir, '.se-cli.json'),
      JSON.stringify(config, null, 2) + '\n',
      'utf8',
    );
  }
  return dir;
}

/** Recursively remove a temp directory. */
function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SESSION TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('Session', () => {
  beforeEach(() => {
    mockState.sockets.length = 0;
    mockState.registry.loadSession.mockReturnValue(null);
    mockState.registry.writeSession.mockClear();
    mockState.registry.deleteSession.mockClear();
    mockState.registry.listSessions.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── canConnect() ──────────────────────────────────────────────────

  describe('canConnect()', () => {
    it('returns true when socket emits connect event', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.canConnect();
      // net.connect was called synchronously inside the Promise constructor
      const sock = mockState.sockets[0];
      sock.emit('connect');
      const result = await promise;
      expect(result).toBe(true);
    });

    it('returns false when socket emits error event', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.canConnect();
      const sock = mockState.sockets[0];
      sock.emit('error', new Error('connect ECONNREFUSED'));
      const result = await promise;
      expect(result).toBe(false);
    });

    it('returns false on timeout', async () => {
      vi.useFakeTimers();
      const session = new Session('/workspace', 'default');
      const promise = session.canConnect();
      // No events emitted — the 1s timeout should fire
      vi.advanceTimersByTime(1000);
      const result = await promise;
      expect(result).toBe(false);
    });
  });

  // ── sendAndClose() tested indirectly via run() and stop() ────────

  describe('sendAndClose() via run()', () => {
    it('sends message and receives response', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');
      const sock = mockState.sockets[0];

      // Simulate daemon accepting connection
      sock.emit('connect');
      // Verify the message was written
      expect(sock.write).toHaveBeenCalledWith(
        expect.stringContaining('"method":"run"'),
      );

      // Simulate daemon responding
      const resp = { ok: true, text: 'Test Page Title' };
      sock.emit('data', Buffer.from(JSON.stringify(resp) + '\n'));

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.text).toBe('Test Page Title');
    });

    it('handles connection timeout (60s)', async () => {
      vi.useFakeTimers();
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');
      // No events emitted — the 60s sendAndClose timeout should fire
      vi.advanceTimersByTime(60000);
      // 'daemon connection timeout' does not match retry-able error
      // patterns, so run() should rethrow immediately
      await expect(promise).rejects.toThrow('daemon connection timeout');
    });

    it('handles non-retryable connection error', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');
      const sock = mockState.sockets[0];
      // Error message doesn't match any retry-able pattern
      sock.emit('error', new Error('unexpected socket failure'));
      await expect(promise).rejects.toThrow('unexpected socket failure');
    });

    it('handles close without response (via stop)', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.stop();
      const sock0 = mockState.sockets[0];
      // Emit 'close' without any preceding 'data' — sendAndClose should
      // reject with 'daemon closed connection without response'
      sock0.emit('close');

      // Wait for stop()'s catch block + canConnect() to create socket[1]
      const sock1 = await waitForSocket(1);
      // Make canConnect() return false so the stop loop exits
      sock1.emit('error', new Error('connect ECONNREFUSED'));

      await promise;
      // deleteSession should have been called regardless of the error
      expect(mockState.registry.deleteSession).toHaveBeenCalledWith(
        'mockhash123',
        'default',
      );
    });

    it('rejects on invalid JSON response from daemon', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');
      const sock = mockState.sockets[0];

      // Simulate daemon sending non-JSON data
      sock.emit('connect');
      sock.emit('data', Buffer.from('not valid json\n'));

      // sendAndClose should reject with a SyntaxError (JSON parse error)
      await expect(promise).rejects.toThrow(SyntaxError);
    });
  });

  // ── stop() ───────────────────────────────────────────────────────

  describe('stop()', () => {
    it('sends stop message and cleans up session', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.stop();

      // sendAndClose creates socket[0]
      const sock0 = mockState.sockets[0];
      sock0.emit('connect');
      // Verify stop message was sent
      expect(sock0.write).toHaveBeenCalledWith(
        expect.stringContaining('"method":"stop"'),
      );
      // Daemon acknowledges
      sock0.emit('data', Buffer.from(JSON.stringify({ ok: true }) + '\n'));

      // stop() then calls canConnect() to wait for daemon exit
      const sock1 = await waitForSocket(1);
      // Daemon is dead — canConnect returns false
      sock1.emit('error', new Error('connect ECONNREFUSED'));

      await promise;

      expect(mockState.registry.deleteSession).toHaveBeenCalledWith(
        'mockhash123',
        'default',
      );
    });

    it('handles errors gracefully when daemon already dead', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.stop();

      // sendAndClose fails — daemon is already dead
      const sock0 = mockState.sockets[0];
      sock0.emit('error', new Error('connect ECONNREFUSED'));

      // stop() catches the error, calls deleteSession, then canConnect()
      const sock1 = await waitForSocket(1);
      sock1.emit('error', new Error('connect ECONNREFUSED'));

      await promise;

      // deleteSession should still be called
      expect(mockState.registry.deleteSession).toHaveBeenCalledWith(
        'mockhash123',
        'default',
      );
    });

    it('retries canConnect up to 10 times while daemon is shutting down', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.stop();

      // sendAndClose succeeds
      const sock0 = mockState.sockets[0];
      sock0.emit('connect');
      sock0.emit('data', Buffer.from(JSON.stringify({ ok: true }) + '\n'));

      // Daemon is slow to exit — canConnect returns true for several iterations
      // then finally returns false (socket error)
      for (let i = 1; i <= 5; i++) {
        const sock = await waitForSocket(i);
        // Simulate connect success (daemon still alive)
        sock.emit('connect');
      }
      // On the 6th attempt, daemon is finally dead
      const sock6 = await waitForSocket(6);
      sock6.emit('error', new Error('connect ECONNREFUSED'));

      await promise;
      expect(mockState.registry.deleteSession).toHaveBeenCalledWith(
        'mockhash123',
        'default',
      );
    });
  });

  // ── loadConfig() ─────────────────────────────────────────────────

  describe('loadConfig()', () => {
    it('returns config from registry', () => {
      const fakeConfig = {
        name: 'default',
        version: '0.6.0',
        timestamp: Date.now(),
        socketPath: '/tmp/socket',
        workspaceDir: '/workspace',
        persistent: false,
        browserName: 'chrome' as const,
        pid: 12345,
      };
      mockState.registry.loadSession.mockReturnValue(fakeConfig);

      const session = new Session('/workspace', 'default');
      const config = session.loadConfig();
      expect(config).toEqual(fakeConfig);
      expect(mockState.registry.loadSession).toHaveBeenCalledWith(
        'mockhash123',
        'default',
      );
    });

    it('returns null when no config exists', () => {
      mockState.registry.loadSession.mockReturnValue(null);
      const session = new Session('/workspace', 'default');
      const config = session.loadConfig();
      expect(config).toBeNull();
    });
  });

  // ── startDaemon() ──────────────────────────────────────────────────

  describe('startDaemon()', () => {
    it('returns "reused" when an alive daemon already owns the socket', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.startDaemon({ browserName: 'chrome' });

      // canConnect() → socket[0]
      const sock0 = mockState.sockets[0];
      sock0.emit('connect');

      // startDaemon ping → socket[1]
      const sock1 = await waitForSocket(1);
      sock1.emit('connect');
      sock1.emit('data', Buffer.from(JSON.stringify({ ok: true, text: 'pong' }) + '\n'));

      await expect(promise).resolves.toBe('reused');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns "reused" even when ping responds with driver error', async () => {
      // A live daemon with a crashed driver is still "reused" — the daemon
      // resets its driver on the next command rather than spawning a window.
      const session = new Session('/workspace', 'default');
      const promise = session.startDaemon({ browserName: 'chrome' });

      const sock0 = mockState.sockets[0];
      sock0.emit('connect');

      const sock1 = await waitForSocket(1);
      sock1.emit('connect');
      sock1.emit(
        'data',
        Buffer.from(
          JSON.stringify({ ok: false, code: 'DRIVER_ERROR', error: 'crash' }) + '\n',
        ),
      );

      await expect(promise).resolves.toBe('reused');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('returns "started" and forwards --idle-timeout to the daemon', async () => {
      mockState.registry.loadSession.mockReturnValue(null);

      let stdoutData: ((d: Buffer) => void) | null = null;
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementationOnce(() => {
        const child: any = {
          pid: 4242,
          stdout: {
            on: (ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') stdoutData = cb; },
            removeListener: vi.fn(),
            unref: vi.fn(),
          },
          stderr: { on: vi.fn(), removeListener: vi.fn(), unref: vi.fn() },
          on: vi.fn(),
          removeListener: vi.fn(),
          kill: vi.fn(),
          unref: vi.fn(),
        };
        return child;
      });

      const session = new Session('/workspace', 'default');
      const promise = session.startDaemon({ browserName: 'chrome', idleTimeout: 120 });

      // canConnect() → socket[0] fails → spawn daemon
      const sock0 = mockState.sockets[0];
      sock0.emit('error', new Error('connect ECONNREFUSED'));

      // Announce listening so startDaemon resolves
      const start = Date.now();
      while (stdoutData === null && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(stdoutData).not.toBeNull();
      stdoutData!(Buffer.from('Daemon listening on /tmp/mock-socket\n'));

      // Health-check ping → socket[1]
      const sock1 = await waitForSocket(1);
      sock1.emit('connect');
      sock1.emit('data', Buffer.from(JSON.stringify({ ok: true, text: 'pong' }) + '\n'));

      await expect(promise).resolves.toBe('started');
      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--idle-timeout=120']),
        expect.anything(),
      );
    });

    it('restarts daemon after killing an unresponsive one', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockState.registry.loadSession.mockReturnValue({
        name: 'default',
        version: '1.0.0',
        timestamp: Date.now(),
        socketPath: '/tmp/mock-socket',
        workspaceDir: '/workspace',
        persistent: false,
        browserName: 'chrome',
        pid: 777,
      });

      let stdoutData: ((d: Buffer) => void) | null = null;
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementationOnce(() => {
        const child: any = {
          pid: 4242,
          stdout: {
            on: (ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') stdoutData = cb; },
            removeListener: vi.fn(),
            unref: vi.fn(),
          },
          stderr: { on: vi.fn(), removeListener: vi.fn(), unref: vi.fn() },
          on: vi.fn(),
          removeListener: vi.fn(),
          kill: vi.fn(),
          unref: vi.fn(),
        };
        return child;
      });

      const session = new Session('/workspace', 'default');
      const promise = session.startDaemon();

      // canConnect() → socket[0] succeeds, but ping hangs → sendAndClose
      // times out only after 60s. Simulate the unresponsive daemon instead
      // by emitting 'close' without data (fast path used by the catch).
      const sock0 = mockState.sockets[0];
      sock0.emit('connect');

      // Ping socket[1] closes without a response → catch → force-kill + respawn
      const sock1 = await waitForSocket(1);
      sock1.emit('close');

      // spawn the replacement daemon
      const start = Date.now();
      while (stdoutData === null && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(stdoutData).not.toBeNull();
      stdoutData!(Buffer.from('Daemon listening on /tmp/mock-socket\n'));

      // Health-check ping → socket[2]
      const sock2 = await waitForSocket(2);
      sock2.emit('connect');
      sock2.emit('data', Buffer.from(JSON.stringify({ ok: true, text: 'pong' }) + '\n'));

      await expect(promise).resolves.toBe('started');
      expect(killSpy).toHaveBeenCalledWith(777, 'SIGKILL');
      expect(mockState.registry.deleteSession).toHaveBeenCalledWith(
        'mockhash123',
        'default',
      );
      killSpy.mockRestore();
    });

    it('retries the health-check ping when the first one fails', async () => {
      let stdoutData: ((d: Buffer) => void) | null = null;
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementationOnce(() => {
        const child: any = {
          pid: 4242,
          stdout: {
            on: (ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') stdoutData = cb; },
            removeListener: vi.fn(),
            unref: vi.fn(),
          },
          stderr: { on: vi.fn(), removeListener: vi.fn(), unref: vi.fn() },
          on: vi.fn(),
          removeListener: vi.fn(),
          kill: vi.fn(),
          unref: vi.fn(),
        };
        return child;
      });

      const session = new Session('/workspace', 'default');
      const promise = session.startDaemon({ browserName: 'edge' });

      // canConnect() fails → spawn daemon
      const sock0 = mockState.sockets[0];
      sock0.emit('error', new Error('connect ECONNREFUSED'));

      // Announce listening
      const start = Date.now();
      while (stdoutData === null && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      stdoutData!(Buffer.from('Daemon listening on /tmp/mock-socket\n'));

      // First health-check ping fails (daemon crashed) → 500ms delay → retry
      const sock1 = await waitForSocket(1);
      sock1.emit('close');

      // Retry ping after the 500ms delay → socket[2]
      const sock2 = await waitForSocket(2, 10000);
      sock2.emit('connect');
      sock2.emit('data', Buffer.from(JSON.stringify({ ok: true, text: 'pong' }) + '\n'));

      await expect(promise).resolves.toBe('started');
    });

    it('rejects with "daemon exited early" when the child exits during startup', async () => {
      let exitHandler: ((code: number | null, signal: any) => void) | null = null;
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementationOnce(() => {
        const child: any = {
          pid: 4242,
          stdout: { on: vi.fn(), removeListener: vi.fn(), unref: vi.fn() },
          stderr: { on: vi.fn(), removeListener: vi.fn(), unref: vi.fn() },
          on: (ev: string, cb: (...a: any[]) => void) => { if (ev === 'exit') exitHandler = cb; },
          removeListener: vi.fn(),
          kill: vi.fn(),
          unref: vi.fn(),
        };
        return child;
      });

      const session = new Session('/workspace', 'default');
      const promise = session.startDaemon({ browserName: 'chrome' });

      // canConnect() fails → spawn daemon → child exits before listening.
      // No socket is created after spawn (listening never announced), so
      // wait until the spawn mock registered its 'exit' handler instead.
      const sock0 = mockState.sockets[0];
      sock0.emit('error', new Error('connect ECONNREFUSED'));

      const start = Date.now();
      while (exitHandler === null && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(exitHandler).not.toBeNull();
      exitHandler!(1, null);

      await expect(promise).rejects.toThrow('daemon exited early');
    });
  });

  // ── run() retry logic ────────────────────────────────────────────

  describe('run() retry logic', () => {
    it('retries on DRIVER_ERROR and succeeds on second attempt', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');

      // Attempt 0: DRIVER_ERROR
      const sock0 = mockState.sockets[0];
      sock0.emit('connect');
      sock0.emit(
        'data',
        Buffer.from(
          JSON.stringify({ ok: false, code: 'DRIVER_ERROR', error: 'crash' }) +
            '\n',
        ),
      );

      // Wait for 1s retry delay, then socket[1] is created
      const sock1 = await waitForSocket(1);
      sock1.emit('connect');
      sock1.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: true, text: 'recovered' }) + '\n'),
      );

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.text).toBe('recovered');
    });

    it('returns DRIVER_ERROR response after all retries exhausted', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');

      // Attempt 0
      const sock0 = mockState.sockets[0];
      sock0.emit('connect');
      sock0.emit(
        'data',
        Buffer.from(
          JSON.stringify({ ok: false, code: 'DRIVER_ERROR', error: 'crash' }) +
            '\n',
        ),
      );

      // Attempt 1 (after 1s delay)
      const sock1 = await waitForSocket(1);
      sock1.emit('connect');
      sock1.emit(
        'data',
        Buffer.from(
          JSON.stringify({ ok: false, code: 'DRIVER_ERROR', error: 'crash' }) +
            '\n',
        ),
      );

      // Attempt 2 (after 2s delay) — attempt < 2 is false, so run() returns
      const sock2 = await waitForSocket(2);
      sock2.emit('connect');
      sock2.emit(
        'data',
        Buffer.from(
          JSON.stringify({ ok: false, code: 'DRIVER_ERROR', error: 'crash' }) +
            '\n',
        ),
      );

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe('DRIVER_ERROR');
    });

    it('retries on ECONNREFUSED and succeeds on second attempt', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');

      // Attempt 0: connection refused
      const sock0 = mockState.sockets[0];
      sock0.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1234'));

      // Wait for 1s retry delay — loadSession returns null so no daemon restart
      const sock1 = await waitForSocket(1);
      sock1.emit('connect');
      sock1.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: true, text: 'success' }) + '\n'),
      );

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.text).toBe('success');
    });

    it('swallows startDaemon failure during restart and retries the connection', async () => {
      mockState.registry.loadSession.mockReturnValue({
        name: 'default',
        version: '1.0.0',
        timestamp: Date.now(),
        socketPath: '/tmp/mock-socket',
        workspaceDir: '/workspace',
        persistent: false,
        browserName: 'chrome',
      });
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');

      // Attempt 0: ECONNREFUSED → loadSession returns config → startDaemon:
      // its canConnect() creates socket[1] → fails → spawn throws →
      // the restart error is swallowed and run() retries.
      const sock0 = mockState.sockets[0];
      sock0.emit('error', new Error('connect ECONNREFUSED'));

      const sock1 = await waitForSocket(1);
      sock1.emit('error', new Error('connect ECONNREFUSED'));

      // Attempt 1: connection succeeds
      const sock2 = await waitForSocket(2);
      sock2.emit('connect');
      sock2.emit('data', Buffer.from(JSON.stringify({ ok: true, text: 'ok' }) + '\n'));

      const result = await promise;
      expect(result.ok).toBe(true);
      mockState.registry.loadSession.mockReset();
    });

    it('throws after all retries fail on ECONNREFUSED', async () => {
      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');

      // Attempt 0
      mockState.sockets[0].emit(
        'error',
        new Error('connect ECONNREFUSED 127.0.0.1:1234'),
      );

      // Attempt 1 (after 1s)
      const sock1 = await waitForSocket(1, 10000);
      sock1.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1234'));

      // Attempt 2 (after 2s)
      const sock2 = await waitForSocket(2, 10000);
      sock2.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1234'));

      // After 3s delay on attempt 2, loop exits and throws lastErr
      await expect(promise).rejects.toThrow('ECONNREFUSED');
    });

    it('restarts daemon with the FULL saved config on connection failure', async () => {
      mockState.registry.loadSession.mockReturnValue({
        name: 'default',
        version: '1.0.0',
        timestamp: Date.now(),
        socketPath: '/tmp/mock-socket',
        workspaceDir: '/workspace',
        persistent: true,
        browserName: 'chrome',
        headed: true,
        cdpEndpoint: 'http://localhost:9222',
        profilePath: '/profiles/p1',
        idleTimeout: 120,
      });

      const session = new Session('/workspace', 'default');
      const promise = session.run(['title'], '/cwd');

      // Attempt 0: ECONNREFUSED → run() loads the saved config and restarts
      mockState.sockets[0].emit(
        'error',
        new Error('connect ECONNREFUSED 127.0.0.1:1234'),
      );

      // startDaemon spawns the daemon child — capture its stdout 'data' cb
      // so the test can announce "listening" and let startDaemon resolve.
      let stdoutData: ((d: Buffer) => void) | null = null;
      const spawnMock = vi.mocked(spawn);
      spawnMock.mockImplementationOnce(() => {
        const child: any = {
          pid: 4242,
          stdout: {
            on: (ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') stdoutData = cb; },
            removeListener: vi.fn(),
            unref: vi.fn(),
          },
          stderr: { on: vi.fn(), removeListener: vi.fn(), unref: vi.fn() },
          on: vi.fn(),
          removeListener: vi.fn(),
          kill: vi.fn(),
          unref: vi.fn(),
        };
        return child;
      });

      // canConnect() inside startDaemon creates socket[1]
      const sock1 = await waitForSocket(1, 10000);
      sock1.emit('error', new Error('connect ECONNREFUSED'));

      // Announce the daemon is listening
      const start = Date.now();
      while (stdoutData === null && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(stdoutData).not.toBeNull();
      stdoutData!(Buffer.from('Daemon listening on /tmp/mock-socket\n'));

      // startDaemon health-check ping → socket[2]
      const sock2 = await waitForSocket(2, 10000);
      sock2.emit('connect');
      sock2.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: true, text: 'pong' }) + '\n'),
      );

      // run() retry attempt 1 → socket[3]
      const sock3 = await waitForSocket(3, 10000);
      sock3.emit('connect');
      sock3.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: true, text: 'recovered' }) + '\n'),
      );

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.text).toBe('recovered');

      // The restarted daemon must receive ALL launch params, not just the browser
      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'chrome',
          '--headed',
          '--cdp=http://localhost:9222',
          '--profile=/profiles/p1',
          '--persistent',
          '--idle-timeout=120',
        ]),
        expect.anything(),
      );
      mockState.registry.loadSession.mockReset();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  callTool TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('callTool', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    tempDirs.forEach(cleanupDir);
  });

  /** Helper that creates a temp dir and tracks it for cleanup. */
  function trackTempDir(config?: object): string {
    const dir = makeTempDir(config);
    tempDirs.push(dir);
    return dir;
  }

  // ── Config commands (no driver needed) ───────────────────────────

  describe('config commands', () => {
    it('config_get returns config value from file', async () => {
      const cwd = trackTempDir({
        wait: { timeout: 8000, state: 'visible', retry: 2 },
      });
      const response = await callTool(
        null,
        'config_get',
        { key: 'wait.timeout' },
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(response.serialize()).toContain('8000');
    });

    it('config_get returns "(no config file found)" when no config exists', async () => {
      const cwd = trackTempDir();
      const response = await callTool(
        null,
        'config_get',
        { key: 'wait.timeout' },
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(response.serialize()).toContain('(no config file found)');
    });

    it('config_get returns "(not set: key)" when key is not found', async () => {
      const cwd = trackTempDir({ wait: { timeout: 5000 } });
      const response = await callTool(
        null,
        'config_get',
        { key: 'timeouts.nonexistent' },
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(response.serialize()).toContain('(not set: timeouts.nonexistent)');
    });

    it('config_set writes value and returns confirmation', async () => {
      const cwd = trackTempDir();
      const response = await callTool(
        null,
        'config_set',
        { key: 'wait.timeout', value: '10000' },
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(response.serialize()).toContain('Set wait.timeout = 10000');

      // Verify the file was actually written
      const written = JSON.parse(
        fs.readFileSync(path.join(cwd, '.se-cli.json'), 'utf8'),
      );
      expect(written.wait.timeout).toBe(10000);
    });

    it('config_list lists all resolved config items', async () => {
      const cwd = trackTempDir({
        wait: { timeout: 8000, state: 'visible' },
      });
      const response = await callTool(
        null,
        'config_list',
        {},
        { raw: false, json: false },
        {},
        cwd,
      );
      const output = response.serialize();
      expect(output).toContain('wait.timeout');
      expect(output).toContain('wait.state');
      expect(output).toContain('timeouts.implicit');
    });

    it('config_init generates template config file', async () => {
      const cwd = trackTempDir(); // no existing config
      const response = await callTool(
        null,
        'config_init',
        {},
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(response.serialize()).toContain('Generated .se-cli.json');
      // Verify the file was created
      expect(fs.existsSync(path.join(cwd, '.se-cli.json'))).toBe(true);
      const content = JSON.parse(
        fs.readFileSync(path.join(cwd, '.se-cli.json'), 'utf8'),
      );
      expect(content.wait).toBeDefined();
      expect(content.timeouts).toBeDefined();
    });
  });

  // ── Unknown tool ─────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns error response for unknown tool name', async () => {
      const cwd = trackTempDir();
      const response = await callTool(
        null,
        'nonexistent_tool',
        {},
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(response.serialize()).toContain('Unknown tool: nonexistent_tool');
    });
  });

  // ── Known tool (no retry) ────────────────────────────────────────

  describe('known tool (no retry)', () => {
    it('calls handler once and returns response', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      const response = await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(driver.getTitle).toHaveBeenCalledTimes(1);
      expect(response.serialize()).toContain('Test Title');
    });

    it('calls switchTo().defaultContent() after handler', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        {},
        cwd,
      );
      expect(driver._defaultContent).toHaveBeenCalledTimes(1);
    });
  });

  // ── Retry logic ──────────────────────────────────────────────────

  describe('retry logic', () => {
    it('retries on handler failure and succeeds (retry=1)', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      driver.getTitle = vi.fn()
        .mockRejectedValueOnce(new Error('element not found'))
        .mockResolvedValue('Recovered Title');

      const response = await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        { retry: '1', 'retry-interval': '10' },
        cwd,
      );

      // Two attempts: first fails, second succeeds
      expect(driver.getTitle).toHaveBeenCalledTimes(2);
      expect(response.serialize()).toContain('Recovered Title');
      // defaultContent called after each attempt (fail + success)
      expect(driver._defaultContent).toHaveBeenCalledTimes(2);
    });

    it('returns error after all retries exhausted (retry=1)', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      driver.getTitle = vi.fn().mockRejectedValue(
        new Error('element not found'),
      );

      const response = await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        { retry: '1', 'retry-interval': '10' },
        cwd,
      );

      // Two attempts: both fail
      expect(driver.getTitle).toHaveBeenCalledTimes(2);
      expect(response.serialize()).toContain('element not found');
      // defaultContent called after each attempt
      expect(driver._defaultContent).toHaveBeenCalledTimes(2);
    });

    it('retries until timeout when retry=-1', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      driver.getTitle = vi.fn().mockRejectedValue(
        new Error('persistent failure'),
      );

      const response = await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        {
          retry: '-1',
          timeout: '50',
          'retry-interval': '5',
        },
        cwd,
      );

      // Should have retried multiple times before timeout
      expect(driver.getTitle.mock.calls.length).toBeGreaterThan(1);
      expect(response.serialize()).toContain('persistent failure');
    });
  });

  // ── Timeout application ──────────────────────────────────────────

  describe('timeout application', () => {
    it('applies pageLoadTimeout and setScriptTimeout with defaults', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        {},
        cwd,
      );
      // Default timeouts: implicit=0 (not applied since >0 check),
      // pageLoad=30000, script=30000
      expect(driver._timeouts.pageLoadTimeout).toHaveBeenCalledWith(30000);
      expect(driver._timeouts.setScriptTimeout).toHaveBeenCalledWith(30000);
      // implicitWait is NOT called when implicit=0
      expect(driver._timeouts.implicitWait).not.toHaveBeenCalled();
    });

    it('applies implicitWait when --implicit-wait flag is set', async () => {
      const cwd = trackTempDir();
      const driver = makeMockDriver();
      await callTool(
        driver,
        'browser_title',
        {},
        { raw: false, json: false },
        { 'implicit-wait': '2000' },
        cwd,
      );
      expect(driver._timeouts.implicitWait).toHaveBeenCalledWith(2000);
      expect(driver._timeouts.pageLoadTimeout).toHaveBeenCalledWith(30000);
      expect(driver._timeouts.setScriptTimeout).toHaveBeenCalledWith(30000);
    });
  });
});
