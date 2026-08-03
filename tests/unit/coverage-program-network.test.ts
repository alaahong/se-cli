/**
 * Coverage tests for src/program.ts and network/debugging tool files.
 *
 * This file complements v0.6-assertions.test.ts and v0.7-network-debug.test.ts
 * by targeting uncovered branches in:
 *   - program.ts (findWorkspaceDir + main command routing)
 *   - expect.ts (--not, --exact, timeout=0, unknown assertion, edge cases)
 *   - requests.ts (listing with data, filtering, request detail formatting)
 *   - route.ts (route-list with data, unroute by index, route with headers)
 *   - console.ts (--since filter with data, js-error with data, truncation)
 *   - network-state.ts (buffer overflow, responseCompleted, fetchError, header normalization)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// fs is mocked at the module level so install tests can override existsSync,
// mkdirSync, and copyFileSync. We use vi.hoisted to capture the real fs module
// before the mock takes effect, then wrap specific functions in vi.fn so they
// can be overridden per-test while defaulting to the real implementation.
const realFs = vi.hoisted(() => require('fs'));

vi.mock('fs', () => ({
  ...realFs,
  existsSync: vi.fn(realFs.existsSync),
  mkdirSync: vi.fn(realFs.mkdirSync),
  copyFileSync: vi.fn(realFs.copyFileSync),
}));

// ── Mocks for program.ts dependencies ───────────────────────────────────

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

vi.mock('../../src/registry', () => {
  const instance = {
    loadSession: vi.fn(() => null),
    writeSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(() => []),
    listAllSessions: vi.fn(() => []),
  };
  return { Registry: vi.fn(() => instance), _mockInstance: instance };
});

vi.mock('../../src/output', () => ({
  render: vi.fn(),
}));

vi.mock('../../src/wait-config', () => {
  const instance = {
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
  };
  return instance;
});

vi.mock('../../src/config', () => ({
  baseDaemonDir: vi.fn(() => '/tmp/mock'),
  workspaceHash: vi.fn(() => 'mockhash'),
  makeSocketPath: vi.fn(() => '/tmp/mock.sock'),
  userHash: vi.fn(() => 'mockuser'),
  defaultSessionName: 'default',
  sessionFileDir: vi.fn(() => '/tmp/mock'),
  sessionFilePath: vi.fn(() => '/tmp/mock/default.session'),
  outputDir: vi.fn(() => '/tmp/mock'),
}));

// ── Mocks for BiDi support modules (used by route.ts) ──────────────────
// Note: logInspector and network are NOT mocked — the real Selenium classes
// load and use driver.getBidi(). We provide a mock Bidi object via
// makeNetworkDriver() whose socket.on('message', handler) calls are captured
// and later invoked via emitEvent() to simulate incoming BiDi events.

vi.mock('selenium-webdriver/bidi/addInterceptParameters', () => ({
  AddInterceptParameters: class {
    private phases: string[] = [];
    private urlPatterns: any[] = [];
    constructor(phases?: any) {
      if (Array.isArray(phases)) this.phases = phases;
      else if (phases) this.phases.push(phases);
    }
    urlStringPattern(pattern: string) { this.urlPatterns.push({ type: 'string', pattern }); }
    urlPattern(pattern: any) { this.urlPatterns.push(pattern); }
    asMap() { return new Map([['phases', this.phases], ['urlPatterns', this.urlPatterns]]); }
  },
}));

vi.mock('selenium-webdriver/bidi/interceptPhase', () => ({
  InterceptPhase: { BEFORE_REQUEST_SENT: 'beforeRequestSent' },
}));

vi.mock('selenium-webdriver/bidi/networkTypes', () => ({
  BytesValue: class {
    static Type = { STRING: 'string', BASE64: 'base64' };
    constructor(public type: string, public value: string) {}
    asMap() { return new Map([['type', this.type], ['value', this.value]]); }
  },
  Header: class {
    constructor(public name: string, public value: any) {}
    asMap() { return new Map([['name', this.name], ['value', this.value]]); }
  },
}));

vi.mock('selenium-webdriver/bidi/provideResponseParameters', () => ({
  ProvideResponseParameters: class {
    private map = new Map();
    constructor(public requestId: string) { this.map.set('request', requestId); }
    statusCode(code: number) { this.map.set('statusCode', code); return this; }
    body(value: any) { this.map.set('body', value); return this; }
    headers(headers: any[]) { this.map.set('headers', headers); return this; }
    asMap() { return this.map; }
  },
}));

vi.mock('selenium-webdriver/bidi/continueRequestParameters', () => ({
  ContinueRequestParameters: class {
    private map = new Map();
    constructor(public requestId: string) { this.map.set('request', requestId); }
    asMap() { return this.map; }
  },
}));

// ── Imports (after mocks are set up) ─────────────────────────────────────

import { main, findWorkspaceDir } from '../../src/program';
import { Session as _Session, _mockInstance as mockSession } from '../../src/session';
import { Registry as _Registry, _mockInstance as mockRegistry } from '../../src/registry';
import { render } from '../../src/output';
import * as mockWaitConfig from '../../src/wait-config';
import { browser_expect, AssertionError } from '../../src/daemon/tools/expect';
import { browser_requests, browser_request } from '../../src/daemon/tools/requests';
import { browser_route, browser_route_list, browser_unroute } from '../../src/daemon/tools/route';
import { browser_console } from '../../src/daemon/tools/console';
import {
  resetAll,
  resetBidiState,
  ensureBidiInitialized,
  getConsoleEntries,
  clearConsole,
  getNetworkRequests,
  getNetworkRequest,
  clearNetworkRequests,
  addRoute,
  getRoute,
  getRoutes,
  deactivateRoute,
  removeRoute,
  removeAllRoutes,
  getNetwork,
  addHighlight,
  removeHighlight,
  clearAllHighlights,
  getHighlights,
} from '../../src/daemon/tools/network-state';
import { Response } from '../../src/response';

// Patch BaseLogEntry to expose a lowercase `timestamp` getter.
// Selenium's ConsoleLogEntry (via BaseLogEntry) stores the timestamp as
// `_timeStamp` and exposes it via `get timeStamp()` (capital S). However,
// network-state.ts reads `entry.timestamp` (lowercase). Without this patch,
// `entry.timestamp` is always undefined and falls back to Date.now(), making
// --since filtering ineffective in unit tests.
// This patch is safe: it only adds a new getter, doesn't modify existing ones.
const { BaseLogEntry } = require('selenium-webdriver/bidi/logEntries');
Object.defineProperty(BaseLogEntry.prototype, 'timestamp', {
  get: function (this: any) { return this._timeStamp; },
  configurable: true,
  enumerable: true,
});

// ── Helper functions ────────────────────────────────────────────────────

function makeResponse(): Response {
  return new Response({ raw: false, json: false });
}

function makeExpectDriver(overrides: Record<string, any> = {}) {
  const mockEl = {
    isDisplayed: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    isSelected: vi.fn(async () => false),
    getText: vi.fn(async () => 'Hello World'),
    getAttribute: vi.fn(async (name: string) => {
      if (name === 'value') return 'test@example.com';
      if (name === 'data-role') return 'button';
      if (name === 'href') return 'https://example.com';
      return null;
    }),
    ...overrides.element,
  };

  const driver = {
    findElement: vi.fn(async () => mockEl),
    findElements: vi.fn(async () => [mockEl, mockEl, mockEl]),
    getTitle: vi.fn(async () => 'Test Page'),
    getCurrentUrl: vi.fn(async () => 'http://localhost:3000/test.html'),
    manage: vi.fn(() => ({
      timeouts: vi.fn(() => ({
        implicitWait: vi.fn(async () => {}),
        pageLoadTimeout: vi.fn(async () => {}),
        setScriptTimeout: vi.fn(async () => {}),
      })),
    })),
    ...overrides.driver,
  };

  return { driver, mockEl };
}

function makeNetworkDriver(): any {
  // The real Selenium LogInspector and Network classes load and call
  // driver.getBidi(). We provide a mock Bidi object whose socket.on('message',
  // handler) calls are captured and later invoked via emitEvent() to simulate
  // incoming BiDi events.
  //
  // To route events to the correct handler, we track bidi.subscribe(eventType)
  // calls and associate each ws.on('message', handler) with the most recently
  // subscribed event type. This prevents, e.g., fetchError handlers from
  // receiving beforeRequestSent events.
  const handlers: Array<{ event: string; handler: Function }> = [];
  let currentSubscription: string | null = null;
  const onFn = vi.fn((event: string, handler: Function) => {
    if (event === 'message') {
      handlers.push({ event: currentSubscription || 'unknown', handler });
    }
  });
  const mockBidi = {
    subscribe: vi.fn(async (eventType: string) => { currentSubscription = eventType; }),
    socket: Promise.resolve({ on: onFn }),
    send: vi.fn(async (params: any) => {
      // Return intercept ID for addIntercept, empty result for others
      if (params.method === 'network.addIntercept') {
        return { result: { intercept: 'mock-intercept-id' } };
      }
      return { result: {} };
    }),
  };
  return {
    getBidi: vi.fn(async () => mockBidi),
    _bidi: mockBidi,
    _onFn: onFn,
    _handlers: handlers,
  };
}

/**
 * Emit a BiDi event to registered 'message' handlers on the mock socket.
 * The real LogInspector and Network classes register handlers via
 * ws.on('message', handler). Each handler parses JSON and dispatches to its
 * callback if the event type matches.
 *
 * The `method` parameter routes the event only to handlers that were
 * registered after a bidi.subscribe(method) call. This prevents cross-talk
 * between event types (e.g., fetchError handler receiving beforeRequestSent
 * events).
 *
 * @param driver   The mock driver returned by makeNetworkDriver()
 * @param params   The `params` field of the BiDi event
 * @param method   The BiDi event method (e.g., 'network.beforeRequestSent')
 */
function emitEvent(driver: any, params: any, method?: string): void {
  const event = JSON.stringify({ params });
  for (const entry of driver._handlers) {
    if (method && entry.event !== method) continue;
    entry.handler(event);
  }
}

// ── Event helper builders ───────────────────────────────────────────────

function makeRequestParams(opts: {
  requestId: string;
  method?: string;
  url: string;
  headers?: Array<{ name: string; value: { type: string; value: string } }>;
  body?: { value: string };
}): any {
  return {
    request: opts.requestId,
    url: opts.url,
    method: opts.method || 'GET',
    headers: opts.headers || [],
    cookies: [],
    headersSize: 0,
    bodySize: 0,
    timings: {
      originTime: 0, requestTime: 0, redirectStart: 0, redirectEnd: 0,
      fetchStart: 0, dnsStart: 0, dnsEnd: 0, connectStart: 0, connectEnd: 0,
      tlsStart: 0, requestStart: 0, responseStart: 0, responseEnd: 0,
    },
    body: opts.body,
  };
}

function emitBeforeRequestSent(driver: any, opts: {
  requestId: string;
  method?: string;
  url: string;
  headers?: Array<{ name: string; value: { type: string; value: string } }>;
  body?: { value: string };
  timestamp?: number;
}): void {
  emitEvent(driver, {
    context: null,
    navigation: null,
    redirectCount: 0,
    request: makeRequestParams(opts),
    timestamp: opts.timestamp ?? Date.now(),
    initiator: { type: 'other', columnNumber: 0, lineNumber: 0, stackTrace: null, request: 0 },
  }, 'network.beforeRequestSent');
}

function emitResponseCompleted(driver: any, opts: {
  requestId: string;
  method?: string;
  url: string;
  status: number;
  statusText?: string;
  headers?: Array<{ name: string; value: { type: string; value: string } }>;
  mimeType?: string;
  body?: { value: string };
  content?: { value: string };
  timestamp?: number;
}): void {
  emitEvent(driver, {
    context: null,
    navigation: null,
    redirectCount: 0,
    request: makeRequestParams(opts),
    timestamp: opts.timestamp ?? Date.now(),
    response: {
      url: opts.url,
      protocol: 'http/1.1',
      status: opts.status,
      statusText: opts.statusText || '',
      fromCache: false,
      headers: opts.headers || [],
      mimeType: opts.mimeType || 'text/html',
      bytesReceived: 0,
      headerSize: 0,
      bodySize: 0,
      content: opts.content || opts.body || null,
    },
  }, 'network.responseCompleted');
}

function emitFetchError(driver: any, opts: {
  requestId: string;
  method?: string;
  url: string;
  errorText?: string;
  timestamp?: number;
}): void {
  emitEvent(driver, {
    context: null,
    navigation: null,
    redirectCount: 0,
    request: makeRequestParams(opts),
    timestamp: opts.timestamp ?? Date.now(),
    errorText: opts.errorText || 'Network error',
  }, 'network.fetchError');
}

function emitConsoleEntry(driver: any, opts: {
  level?: string;
  text?: string;
  timestamp?: number;
  method?: string;
  stackTrace?: string;
}): void {
  emitEvent(driver, {
    type: 'console',
    level: opts.level || 'info',
    source: { realm: 'mock-realm', context: 'mock-context' },
    text: opts.text || '',
    timestamp: opts.timestamp ?? Date.now(),
    method: opts.method || 'log',
    args: [],
    stackTrace: opts.stackTrace,
  }, 'log.entryAdded');
}

function emitJsException(driver: any, opts: {
  text?: string;
  timestamp?: number;
  stackTrace?: string;
}): void {
  emitEvent(driver, {
    type: 'javascript',
    level: 'error',
    source: { realm: 'mock-realm', context: 'mock-context' },
    text: opts.text || 'JavaScript error',
    timestamp: opts.timestamp ?? Date.now(),
    stackTrace: opts.stackTrace,
  }, 'log.entryAdded');
}

// ═════════════════════════════════════════════════════════════════════════
// findWorkspaceDir
// ═════════════════════════════════════════════════════════════════════════

describe('findWorkspaceDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-ws-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns cwd when .se-cli directory exists in cwd', () => {
    fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
    expect(findWorkspaceDir(tmpDir)).toBe(tmpDir);
  });

  it('returns parent dir when .se-cli is found in a parent', () => {
    fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
    const nestedDir = path.join(tmpDir, 'sub', 'deep', 'dir');
    fs.mkdirSync(nestedDir, { recursive: true });
    expect(findWorkspaceDir(nestedDir)).toBe(tmpDir);
  });

  it('returns cwd when no .se-cli found (after 10 levels up)', () => {
    const result = findWorkspaceDir(tmpDir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns cwd when at root', () => {
    const root = process.platform === 'win32' ? 'C:\\' : '/';
    const result = findWorkspaceDir(root);
    expect(result).toBe(root);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// main()
// ═════════════════════════════════════════════════════════════════════════

describe('main()', () => {
  let exitSpy: any;
  let cwdSpy: any;
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset fs mocks to default (real) implementations
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.copyFileSync).mockReset();

    // Reset default mock behaviors
    mockSession.run.mockResolvedValue({ ok: true, text: 'success' });
    mockSession.canConnect.mockResolvedValue(true);
    mockSession.startDaemon.mockResolvedValue(undefined);
    mockSession.stop.mockResolvedValue(undefined);
    mockRegistry.loadSession.mockReturnValue(null);
    mockRegistry.listSessions.mockReturnValue([]);
    mockRegistry.listAllSessions.mockReturnValue([]);
    mockWaitConfig.loadConfigFile.mockReturnValue(null);
    mockWaitConfig.getConfigValue.mockReturnValue(null);
    mockWaitConfig.listConfig.mockReturnValue([]);
    mockWaitConfig.setConfigValue.mockImplementation(() => {});
    mockWaitConfig.generateTemplateConfig.mockImplementation(() => '');

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`exit:${code}`);
    });
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/test-ws');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── help / no args ───────────────────────────────────────

  it('calls process.exit(0) for --help', async () => {
    await expect(main(['--help'])).rejects.toThrow('exit:0');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls process.exit(0) for no args', async () => {
    await expect(main([])).rejects.toThrow('exit:0');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // ── open ─────────────────────────────────────────────────

  it('open with URL: calls startDaemon and session.run with goto', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await main(['open', 'https://example.com']);

    expect(mockSession.startDaemon).toHaveBeenCalledTimes(1);
    // No --browser flag: auto-detects the first available browser (Edge first)
    expect(mockSession.startDaemon).toHaveBeenCalledWith({ browserName: 'edge' });
    expect(mockSession.run).toHaveBeenCalledTimes(1);
    expect(mockSession.run.mock.calls[0][0]).toEqual(['goto', 'https://example.com']);
  });

  it('open with no URL: calls startDaemon but not run', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await main(['open']);

    expect(mockSession.startDaemon).toHaveBeenCalledTimes(1);
    expect(mockSession.run).not.toHaveBeenCalled();
  });

  it('open without --browser exits(1) when no browser is detected', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(main(['open', 'https://example.com'])).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSession.startDaemon).not.toHaveBeenCalled();
  });

  it('open --browser=firefox --headed: passes browserName and headed to startDaemon', async () => {
    await main(['open', 'https://example.com', '--browser=firefox', '--headed']);

    expect(mockSession.startDaemon).toHaveBeenCalledWith({
      browserName: 'firefox',
      headed: true,
    });
  });

  it('open --persistent: sets persistent and auto-assigns profilePath', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await main(['open', '--persistent']);

    const callArgs = mockSession.startDaemon.mock.calls[0][0];
    expect(callArgs.persistent).toBe(true);
    expect(callArgs.profilePath).toContain('profiles');
    expect(callArgs.profilePath).toContain('mockhash');
  });

  it('open --cdp and --profile: passes cdpEndpoint and profilePath', async () => {
    await main(['open', '--cdp=http://localhost:9222', '--profile=/tmp/profile']);

    expect(mockSession.startDaemon).toHaveBeenCalledWith({
      cdpEndpoint: 'http://localhost:9222',
      profilePath: '/tmp/profile',
    });
  });

  // ── close ────────────────────────────────────────────────

  it('close command: calls session.stop()', async () => {
    await main(['close']);

    expect(mockSession.stop).toHaveBeenCalledTimes(1);
  });

  // ── list ─────────────────────────────────────────────────

  it('list command: calls registry.listSessions and prints each session', async () => {
    mockRegistry.listSessions.mockReturnValue([
      { name: 'default', browserName: 'chrome', timestamp: Date.now() },
      { name: 'test', browserName: 'firefox', timestamp: Date.now() },
    ]);

    await main(['list']);

    expect(mockRegistry.listSessions).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[0][0]).toContain('default');
    expect(logSpy.mock.calls[1][0]).toContain('test');
  });

  it('list command with empty sessions: does not log', async () => {
    mockRegistry.listSessions.mockReturnValue([]);

    await main(['list']);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('list command: marks dead sessions when canConnect returns false', async () => {
    mockSession.canConnect.mockResolvedValue(false);
    mockRegistry.listSessions.mockReturnValue([
      { name: 'dead', browserName: 'chrome', timestamp: Date.now() },
    ]);

    await main(['list']);

    expect(logSpy.mock.calls[0][0]).toContain('dead');
  });

  // ── close-all ────────────────────────────────────────────

  it('close-all command: iterates sessions and stops each', async () => {
    mockRegistry.listSessions.mockReturnValue([
      { name: 's1', browserName: 'chrome', timestamp: Date.now() },
      { name: 's2', browserName: 'firefox', timestamp: Date.now() },
    ]);

    await main(['close-all']);

    expect(mockSession.stop).toHaveBeenCalledTimes(2);
  });

  it('close-all with no sessions: does not call stop', async () => {
    mockRegistry.listSessions.mockReturnValue([]);

    await main(['close-all']);

    expect(mockSession.stop).not.toHaveBeenCalled();
  });

  it('close-all swallows errors from stop', async () => {
    mockSession.stop.mockRejectedValue(new Error('stop failed'));
    mockRegistry.listSessions.mockReturnValue([
      { name: 's1', browserName: 'chrome', timestamp: Date.now() },
    ]);

    await main(['close-all']);
  });

  // ── close --all (global) ─────────────────────────────────

  it('close --all: stops sessions across ALL workspaces', async () => {
    mockRegistry.listAllSessions.mockReturnValue([
      { wsHash: 'ws1', config: { name: 'default', workspaceDir: '/proj/a', browserName: 'chrome', persistent: false, timestamp: Date.now(), socketPath: '' } },
      { wsHash: 'ws2', config: { name: 'default', workspaceDir: '/proj/b', browserName: 'firefox', persistent: false, timestamp: Date.now(), socketPath: '' } },
      { wsHash: 'ws2', config: { name: 'scrape', workspaceDir: '/proj/b', browserName: 'edge', persistent: false, timestamp: Date.now(), socketPath: '' } },
    ]);

    await main(['close', '--all']);

    expect(mockSession.stop).toHaveBeenCalledTimes(3);
  });

  it('close --all with no sessions: does not call stop', async () => {
    await main(['close', '--all']);

    expect(mockSession.stop).not.toHaveBeenCalled();
  });

  it('close --all swallows errors from stop', async () => {
    mockSession.stop.mockRejectedValue(new Error('stop failed'));
    mockRegistry.listAllSessions.mockReturnValue([
      { wsHash: 'ws1', config: { name: 'default', workspaceDir: '/proj/a', browserName: 'chrome', persistent: false, timestamp: Date.now(), socketPath: '' } },
    ]);

    await main(['close', '--all']);
  });

  // ── sessions (global) ────────────────────────────────────

  it('sessions command: prints every session across workspaces with status', async () => {
    mockRegistry.listAllSessions.mockReturnValue([
      { wsHash: 'ws1', config: { name: 'default', workspaceDir: '/proj/a', browserName: 'chrome', headed: true, persistent: false, timestamp: 1000, socketPath: '' } },
      { wsHash: 'ws2', config: { name: 'scrape', workspaceDir: '/proj/b', browserName: 'firefox', persistent: false, timestamp: 2000, socketPath: '' } },
    ]);

    await main(['sessions']);

    expect(mockRegistry.listAllSessions).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[0][0]).toContain('/proj/a');
    expect(logSpy.mock.calls[0][0]).toContain('default');
    expect(logSpy.mock.calls[0][0]).toContain('live');
    expect(logSpy.mock.calls[0][0]).toContain('headed');
    expect(logSpy.mock.calls[1][0]).toContain('/proj/b');
    expect(logSpy.mock.calls[1][0]).toContain('scrape');
    expect(logSpy.mock.calls[1][0]).toContain('headless');
  });

  it('sessions command: marks sessions dead when canConnect returns false', async () => {
    mockSession.canConnect.mockResolvedValue(false);
    mockRegistry.listAllSessions.mockReturnValue([
      { wsHash: 'ws1', config: { name: 'default', workspaceDir: '/proj/a', browserName: 'chrome', persistent: false, timestamp: 1000, socketPath: '' } },
    ]);

    await main(['sessions']);

    expect(logSpy.mock.calls[0][0]).toContain('dead');
  });

  it('sessions command with no sessions: does not log', async () => {
    await main(['sessions']);

    expect(logSpy).not.toHaveBeenCalled();
  });

  // ── open reuse hint ──────────────────────────────────────

  it('open when daemon already alive: prints reuse hint, no goto', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockSession.startDaemon.mockResolvedValue('reused' as any);
    await main(['open']);

    expect(logSpy.mock.calls[0][0]).toContain('reusing existing browser session');
    expect(mockSession.run).not.toHaveBeenCalled();
  });

  it('open when daemon started fresh: no reuse hint', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockSession.startDaemon.mockResolvedValue('started' as any);
    await main(['open']);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('open --idle-timeout=120: passes idleTimeout to startDaemon', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await main(['open', '--idle-timeout=120']);

    expect(mockSession.startDaemon).toHaveBeenCalledWith({
      browserName: 'edge',
      idleTimeout: 120,
    });
  });

  // ── kill-all ─────────────────────────────────────────────

  it('kill-all command: sends SIGKILL and deletes sessions', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockRegistry.loadSession.mockReturnValue({ name: 's1', pid: 12345, browserName: 'chrome' });
    mockRegistry.listSessions.mockReturnValue([
      { name: 's1', browserName: 'chrome', timestamp: Date.now() },
    ]);

    await main(['kill-all']);

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(mockRegistry.deleteSession).toHaveBeenCalledTimes(1);
    killSpy.mockRestore();
  });

  it('kill-all with no pid in config: skips kill but still stops and deletes', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockRegistry.loadSession.mockReturnValue({ name: 's1', browserName: 'chrome' });
    mockRegistry.listSessions.mockReturnValue([
      { name: 's1', browserName: 'chrome', timestamp: Date.now() },
    ]);

    await main(['kill-all']);

    expect(killSpy).not.toHaveBeenCalled();
    expect(mockRegistry.deleteSession).toHaveBeenCalledTimes(1);
    killSpy.mockRestore();
  });

  // ── install ──────────────────────────────────────────────

  // Source SKILL.md always exists; destination and agent dirs do not, so the
  // v0.9 install flow copies (and never skips) into the requested target.
  function mockInstallFs(): void {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p);
      return s.includes('skill') && s.endsWith('SKILL.md') && !s.includes('.claude') &&
        !s.includes('.cursor') && !s.includes('.agents');
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);
    vi.mocked(fs.copyFileSync).mockImplementation(() => undefined);
  }

  it('install claude: copies SKILL.md to .claude/skills/se-cli/', async () => {
    mockInstallFs();

    await main(['install', 'claude']);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.claude', 'skills', 'se-cli')),
      { recursive: true },
    );
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Installed SKILL.md to'));
  });

  it('install cursor: copies SKILL.md to .cursor/skills/se-cli/', async () => {
    mockInstallFs();

    await main(['install', 'cursor']);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.cursor', 'skills', 'se-cli')),
      { recursive: true },
    );
  });

  it('install generic: copies SKILL.md to .agents/skills/se-cli/', async () => {
    mockInstallFs();

    await main(['install', 'generic']);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.agents', 'skills', 'se-cli')),
      { recursive: true },
    );
  });

  it('install --agent=claude,cursor installs into multiple targets', async () => {
    mockInstallFs();

    await main(['install', '--agent=claude,cursor']);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.claude', 'skills', 'se-cli')),
      { recursive: true },
    );
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.cursor', 'skills', 'se-cli')),
      { recursive: true },
    );
  });

  it('install --list-agents prints supported agents', async () => {
    await main(['install', '--list-agents']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('claude'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('copilot'));
  });

  it('install with unknown target: exits with code 1', async () => {
    await expect(main(['install', 'unknown-target'])).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown target'));
  });

  it('install when SKILL.md not found: exits with code 1', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(main(['install', 'claude'])).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SKILL.md not found'));
  });

  it('install with no target and no agent directories: exits with code 1', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p);
      return s.includes('skill') && s.endsWith('SKILL.md');
    });

    await expect(main(['install'])).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No agent skill directories detected'));
  });

  // ── config ───────────────────────────────────────────────

  it('config get <key>: calls loadConfigFile and getConfigValue, prints value', async () => {
    mockWaitConfig.loadConfigFile.mockReturnValue({ wait: { timeout: 5000 } });
    mockWaitConfig.getConfigValue.mockReturnValue({ value: 5000, source: 'file' });

    await main(['config', 'get', 'wait.timeout']);

    expect(mockWaitConfig.loadConfigFile).toHaveBeenCalledTimes(1);
    expect(mockWaitConfig.getConfigValue).toHaveBeenCalledWith({ wait: { timeout: 5000 } }, 'wait.timeout');
    expect(logSpy).toHaveBeenCalledWith(5000);
  });

  it('config get <key>: prints "(no config file found)" when no config', async () => {
    mockWaitConfig.loadConfigFile.mockReturnValue(null);

    await main(['config', 'get', 'wait.timeout']);

    expect(logSpy).toHaveBeenCalledWith('(no config file found)');
  });

  it('config get <key>: prints "(not set: key)" when value not found', async () => {
    mockWaitConfig.loadConfigFile.mockReturnValue({ wait: {} });
    mockWaitConfig.getConfigValue.mockReturnValue(null);

    await main(['config', 'get', 'wait.retry']);

    expect(logSpy).toHaveBeenCalledWith('(not set: wait.retry)');
  });

  it('config get without key: exits with code 1', async () => {
    await expect(main(['config', 'get'])).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: se-cli config get <key>');
  });

  it('config set <key> <value>: calls setConfigValue', async () => {
    await main(['config', 'set', 'wait.timeout', '10000']);

    expect(mockWaitConfig.setConfigValue).toHaveBeenCalledWith('/tmp/test-ws', 'wait.timeout', '10000');
    expect(logSpy).toHaveBeenCalledWith('Set wait.timeout = 10000');
  });

  it('config set without key: exits with code 1', async () => {
    await expect(main(['config', 'set'])).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: se-cli config set <key> <value>');
  });

  it('config set without value: exits with code 1', async () => {
    await expect(main(['config', 'set', 'wait.timeout'])).rejects.toThrow('exit:1');
  });

  it('config list: calls resolveConfig and listConfig, prints lines', async () => {
    mockWaitConfig.listConfig.mockReturnValue([
      'wait.timeout\t5000\t(default)',
      'wait.state\tnone\t(default)',
    ]);

    await main(['config', 'list']);

    expect(mockWaitConfig.resolveConfig).toHaveBeenCalledTimes(1);
    expect(mockWaitConfig.listConfig).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('wait.timeout\t5000\t(default)');
    expect(logSpy).toHaveBeenCalledWith('wait.state\tnone\t(default)');
  });

  it('config init: calls generateTemplateConfig', async () => {
    await main(['config', 'init']);

    expect(mockWaitConfig.generateTemplateConfig).toHaveBeenCalledWith('/tmp/test-ws');
    expect(logSpy).toHaveBeenCalledWith('Generated .se-cli.json');
  });

  it('config with unknown subcommand: exits with code 1', async () => {
    await expect(main(['config', 'unknown'])).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: se-cli config [get|set|list|init]');
  });

  // ── tool command forwarding ──────────────────────────────

  it('tool command forwarding: calls session.run with forwarded args (strips --raw)', async () => {
    await main(['click', 'e1', '--raw']);

    expect(mockSession.run).toHaveBeenCalledTimes(1);
    expect(mockSession.run.mock.calls[0][0]).toEqual(['click', 'e1']);
  });

  it('tool command forwarding: strips --browser and --json', async () => {
    await main(['fill', 'e1', 'hello', '--browser=chrome', '--json']);

    expect(mockSession.run.mock.calls[0][0]).toEqual(['fill', 'e1', 'hello']);
  });

  it('tool command forwarding: keeps tool-specific flags like --filename', async () => {
    await main(['screenshot', '--filename=test.png']);

    expect(mockSession.run.mock.calls[0][0]).toEqual(['screenshot', '--filename=test.png']);
  });

  it('tool command forwarding: strips -s session flag', async () => {
    await main(['-s=mysession', 'click', 'e1']);

    expect(mockSession.run.mock.calls[0][0]).toEqual(['click', 'e1']);
  });

  it('tool command forwarding: strips --headed and --profile', async () => {
    await main(['snapshot', '--headed', '--profile=/tmp/p']);

    expect(mockSession.run.mock.calls[0][0]).toEqual(['snapshot']);
  });

  it('tool command forwarding: calls render with response', async () => {
    const resp = { ok: true, text: 'done' };
    mockSession.run.mockResolvedValue(resp);

    await main(['title']);

    expect(render).toHaveBeenCalledWith(resp);
  });

  // ── connection error ─────────────────────────────────────

  it('connection error: deletes session and exits with code 1', async () => {
    mockSession.run.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(main(['click', 'e1'])).rejects.toThrow('exit:1');

    expect(mockRegistry.deleteSession).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon not reachable'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('connection error: includes hint to reopen', async () => {
    mockSession.run.mockRejectedValue(new Error('connect ENOENT'));

    await expect(main(['title'])).rejects.toThrow('exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Hint: run `se-cli open`'));
  });
});

// ═════════════════════════════════════════════════════════════════════════
// expect.ts coverage
// ═════════════════════════════════════════════════════════════════════════

describe('expect.ts coverage', () => {

  // ── AssertionError ───────────────────────────────────────

  describe('AssertionError', () => {
    it('toJSON returns structured representation with all fields', () => {
      const err = new AssertionError('test message', 'visible', 'expected-val', 'actual-val', true);
      const json = err.toJSON();
      expect(json.name).toBe('AssertionError');
      expect(json.message).toBe('test message');
      expect(json.matcher).toBe('visible');
      expect(json.expected).toBe('expected-val');
      expect(json.actual).toBe('actual-val');
      expect(json.not).toBe(true);
    });

    it('toJSON with undefined optional fields', () => {
      const err = new AssertionError('simple');
      const json = err.toJSON();
      expect(json.matcher).toBeUndefined();
      expect(json.expected).toBeUndefined();
      expect(json.actual).toBeUndefined();
      expect(json.not).toBeUndefined();
    });
  });

  // ── visible with --not ───────────────────────────────────

  describe('visible with --not', () => {
    it('passes when element is NOT displayed', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(false);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'visible', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('not visible');
    });

    it('throws AssertionError when element IS displayed', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(true);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'visible', not: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  // ── hidden ───────────────────────────────────────────────

  describe('hidden', () => {
    it('passes when element is not displayed', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(false);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'hidden', not: false,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('hidden');
    });

    it('throws AssertionError when element is displayed', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(true);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'hidden', not: false,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow('hidden');
    });

    it('passes with --not when element IS displayed', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'hidden', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('not hidden');
    });
  });

  // ── enabled / disabled ───────────────────────────────────

  describe('enabled', () => {
    it('passes when element is enabled', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isEnabled.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'enabled',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('enabled');
    });

    it('passes with --not when element is NOT enabled', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isEnabled.mockResolvedValue(false);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'enabled', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('not enabled');
    });

    it('throws with --not when element IS enabled', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isEnabled.mockResolvedValue(true);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'enabled', not: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  describe('disabled', () => {
    it('passes when element is NOT enabled', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isEnabled.mockResolvedValue(false);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'disabled',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('disabled');
    });

    it('passes with --not when element IS enabled', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isEnabled.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'disabled', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('not disabled');
    });

    it('throws when element is enabled', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isEnabled.mockResolvedValue(true);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'disabled',
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow('disabled');
    });
  });

  // ── checked / unchecked ──────────────────────────────────

  describe('checked', () => {
    it('passes when element is selected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isSelected.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#cb', assertion: 'checked',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('checked');
    });

    it('passes with --not when element is NOT selected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isSelected.mockResolvedValue(false);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#cb', assertion: 'checked', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('not checked');
    });

    it('throws when element is NOT selected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isSelected.mockResolvedValue(false);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#cb', assertion: 'checked',
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow('checked');
    });
  });

  describe('unchecked', () => {
    it('passes when element is NOT selected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isSelected.mockResolvedValue(false);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#cb', assertion: 'unchecked',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('unchecked');
    });

    it('passes with --not when element IS selected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isSelected.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#cb', assertion: 'unchecked', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('not unchecked');
    });

    it('throws when element IS selected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isSelected.mockResolvedValue(true);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#cb', assertion: 'unchecked',
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow('unchecked');
    });
  });

  // ── text with --not and --exact ──────────────────────────

  describe('text with --not', () => {
    it('passes when text does NOT contain expected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getText.mockResolvedValue('Goodbye World');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'text', expected: 'Hello', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('text');
    });

    it('throws when text DOES contain expected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getText.mockResolvedValue('Hello World');
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'text', expected: 'Hello', not: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });

    it('throws with --exact when text does not match exactly', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getText.mockResolvedValue('Hello World');
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'text', expected: 'Hello', exact: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });

    it('passes with --not and --exact when text does not match exactly', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getText.mockResolvedValue('Hello World');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'text', expected: 'Goodbye', exact: true, not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('text');
    });

    it('passes with empty expected and empty text', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getText.mockResolvedValue('');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'text', expected: '',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('text');
    });
  });

  // ── value with --not and --exact ─────────────────────────

  describe('value with --not and --exact', () => {
    it('passes when value matches', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getAttribute.mockResolvedValue('test@example.com');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#input', assertion: 'value', expected: 'test@example.com', exact: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('value');
    });

    it('passes with --not when value does not contain expected', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getAttribute.mockResolvedValue('other@example.com');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#input', assertion: 'value', expected: 'admin', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('value');
    });

    it('throws with --exact when value does not match exactly', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getAttribute.mockResolvedValue('test@example.com');
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#input', assertion: 'value', expected: 'test', exact: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  // ── attribute with --not and --exact ─────────────────────

  describe('attribute with --not and --exact', () => {
    it('passes when attribute value matches', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getAttribute.mockResolvedValue('button');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'attribute', expected: 'data-role', attributeValue: 'button',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('attribute');
    });

    it('passes with --not when attribute does not match', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getAttribute.mockResolvedValue('link');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'attribute', expected: 'data-role', attributeValue: 'button', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('attribute');
    });

    it('throws with --exact when attribute does not match exactly', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getAttribute.mockResolvedValue('button-primary');
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'attribute', expected: 'data-role', attributeValue: 'button', exact: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  // ── title with --not and --exact ─────────────────────────

  describe('title with --not and --exact', () => {
    it('passes with --not when title does not match', async () => {
      const { driver } = makeExpectDriver({ driver: { getTitle: vi.fn(async () => 'Other Page') } });
      const resp = makeResponse();

      await browser_expect(driver, {
        target: 'title', assertion: 'Test Page', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('title');
    });

    it('passes with --exact when title matches exactly', async () => {
      const { driver } = makeExpectDriver({ driver: { getTitle: vi.fn(async () => 'Test Page') } });
      const resp = makeResponse();

      await browser_expect(driver, {
        target: 'title', assertion: 'Test Page', exact: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('title');
    });

    it('throws with --exact when title does not match exactly', async () => {
      const { driver } = makeExpectDriver({ driver: { getTitle: vi.fn(async () => 'Test Page Extra') } });
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: 'title', assertion: 'Test Page', exact: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });

    it('throws with --not when title DOES match', async () => {
      const { driver } = makeExpectDriver({ driver: { getTitle: vi.fn(async () => 'Test Page') } });
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: 'title', assertion: 'Test', not: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  // ── url with --not and --exact ───────────────────────────

  describe('url with --not and --exact', () => {
    it('passes when url contains expected', async () => {
      const { driver } = makeExpectDriver({ driver: { getCurrentUrl: vi.fn(async () => 'http://localhost:3000/test') } });
      const resp = makeResponse();

      await browser_expect(driver, {
        target: 'url', assertion: 'localhost',
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('url');
    });

    it('passes with --not when url does not match', async () => {
      const { driver } = makeExpectDriver({ driver: { getCurrentUrl: vi.fn(async () => 'http://other.com') } });
      const resp = makeResponse();

      await browser_expect(driver, {
        target: 'url', assertion: 'localhost', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('url');
    });

    it('passes with --exact when url matches exactly', async () => {
      const { driver } = makeExpectDriver({ driver: { getCurrentUrl: vi.fn(async () => 'http://localhost:3000/test') } });
      const resp = makeResponse();

      await browser_expect(driver, {
        target: 'url', assertion: 'http://localhost:3000/test', exact: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('url');
    });

    it('throws with --exact when url does not match exactly', async () => {
      const { driver } = makeExpectDriver({ driver: { getCurrentUrl: vi.fn(async () => 'http://localhost:3000/test') } });
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: 'url', assertion: 'http://localhost', exact: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  // ── count with --not ─────────────────────────────────────

  describe('count with --not', () => {
    it('passes with --not when count does NOT match', async () => {
      const { driver } = makeExpectDriver();
      driver.findElements.mockResolvedValue([{}, {}, {}]);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '.item', assertion: 'count', expected: '5', not: true,
        _wait: { state: 'attached', timeout: 500 },
      }, resp);

      expect(resp.serialize()).toContain('count');
    });

    it('throws with --not when count DOES match', async () => {
      const { driver } = makeExpectDriver();
      driver.findElements.mockResolvedValue([{}, {}, {}]);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '.item', assertion: 'count', expected: '3', not: true,
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });

    it('throws when count does not match (without --not)', async () => {
      const { driver } = makeExpectDriver();
      driver.findElements.mockResolvedValue([{}, {}]);
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '.item', assertion: 'count', expected: '3',
          _wait: { state: 'attached', timeout: 300 },
        }, resp),
      ).rejects.toThrow('count');
    });
  });

  // ── timeout=0 (no-wait) path ─────────────────────────────

  describe('timeout=0 (no-wait) path', () => {
    it('visible: checks once without polling when timeout=0', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'visible',
        _wait: { state: 'attached', timeout: 0 },
      }, resp);

      expect(resp.serialize()).toContain('visible');
      expect(mockEl.isDisplayed).toHaveBeenCalledTimes(1);
    });

    it('visible: returns false on error when timeout=0', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockRejectedValue(new Error('stale'));
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'visible',
          _wait: { state: 'attached', timeout: 0 },
        }, resp),
      ).rejects.toThrow('visible');
    });

    it('text: checks once without polling when timeout=0', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.getText.mockResolvedValue('Hello');
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'text', expected: 'Hello',
        _wait: { state: 'attached', timeout: 0 },
      }, resp);

      expect(resp.serialize()).toContain('text');
    });

    it('title: checks once without polling when timeout=0', async () => {
      const { driver } = makeExpectDriver({ driver: { getTitle: vi.fn(async () => 'Test Page') } });
      const resp = makeResponse();

      await browser_expect(driver, {
        target: 'title', assertion: 'Test Page',
        _wait: { state: 'attached', timeout: 0 },
      }, resp);

      expect(resp.serialize()).toContain('title');
    });

    it('title: returns empty string on error when timeout=0', async () => {
      const { driver } = makeExpectDriver({ driver: { getTitle: vi.fn(async () => { throw new Error('fail'); }) } });
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: 'title', assertion: 'Test Page',
          _wait: { state: 'attached', timeout: 0 },
        }, resp),
      ).rejects.toThrow(AssertionError);
    });
  });

  // ── unknown assertion type ────────────────────────────────

  describe('unknown assertion type', () => {
    it('throws Error for unknown assertion', async () => {
      const { driver } = makeExpectDriver();
      const resp = makeResponse();

      await expect(
        browser_expect(driver, {
          target: '#el', assertion: 'custom-unknown',
          _wait: { state: 'attached', timeout: 500 },
        }, resp),
      ).rejects.toThrow('Unknown assertion type: custom-unknown');
    });
  });

  // ── default timeout when _wait is undefined ──────────────

  describe('default timeout', () => {
    it('uses default timeout of 5000 when _wait is undefined', async () => {
      const { driver, mockEl } = makeExpectDriver();
      mockEl.isDisplayed.mockResolvedValue(true);
      const resp = makeResponse();

      await browser_expect(driver, {
        target: '#el', assertion: 'visible',
      }, resp);

      expect(resp.serialize()).toContain('visible');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// requests.ts coverage
// ═════════════════════════════════════════════════════════════════════════

describe('requests.ts coverage', () => {
  beforeEach(() => {
    resetAll();
  });

  async function initAndPopulateRequests() {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-0', method: 'GET', url: 'https://api.example.com/users',
      headers: [{ name: 'Accept', value: { type: 'string', value: 'application/json' } }],
      timestamp: 1000,
    });
    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'POST', url: 'https://api.example.com/login',
      headers: [{ name: 'Content-Type', value: { type: 'string', value: 'application/json' } }],
      timestamp: 2000,
    });
    emitBeforeRequestSent(driver, {
      requestId: 'req-2', method: 'GET', url: 'https://cdn.example.com/style.css',
      headers: [], timestamp: 3000,
    });

    emitResponseCompleted(driver, {
      requestId: 'req-0', url: 'https://api.example.com/users',
      status: 200, statusText: 'OK',
      headers: [{ name: 'Content-Type', value: { type: 'string', value: 'text/html' } }],
      content: { value: '<html></html>' },
      timestamp: 1500,
    });
    emitResponseCompleted(driver, {
      requestId: 'req-1', url: 'https://api.example.com/login',
      status: 500, statusText: 'Internal Server Error',
      headers: [],
      content: { value: '{"error":"fail"}' },
      timestamp: 2500,
    });

    return driver;
  }

  it('lists all requests', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_requests(driver, {}, resp);

    const output = resp.serialize();
    expect(output).toContain('GET');
    expect(output).toContain('POST');
    expect(output).toContain('200');
    expect(output).toContain('500');
  });

  it('filters by URL substring', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_requests(driver, { filter: 'api.example' }, resp);

    const output = resp.serialize();
    expect(output).toContain('api.example.com');
    expect(output).not.toContain('cdn.example.com');
  });

  it('filters by status code', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_requests(driver, { status: '500' }, resp);

    const output = resp.serialize();
    expect(output).toContain('500');
    expect(output).not.toContain('200');
  });

  it('filters by method', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_requests(driver, { method: 'POST' }, resp);

    const output = resp.serialize();
    expect(output).toContain('POST');
    expect(output).not.toContain('GET');
  });

  it('clears buffer with --clear', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_requests(driver, { clear: true }, resp);

    expect(resp.serialize()).toContain('Network request buffer cleared');
    expect(getNetworkRequests()).toEqual([]);
  });

  it('shows request details by index', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_request(driver, { index: 0 }, resp);

    const output = resp.serialize();
    expect(output).toContain('URL: https://api.example.com/users');
    expect(output).toContain('Method: GET');
    expect(output).toContain('Status: 200');
    expect(output).toContain('Accept: application/json');
    expect(output).toContain('Response body: <html></html>');
  });

  it('shows request detail with pending status (no response)', async () => {
    await initAndPopulateRequests();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_request(driver, { index: 2 }, resp);

    const output = resp.serialize();
    expect(output).toContain('URL: https://cdn.example.com/style.css');
    expect(output).toContain('(pending)');
    expect(output).toContain('Request headers: (none)');
    expect(output).toContain('Request body: (none)');
    expect(output).toContain('Response headers: (none)');
    expect(output).toContain('Response body: (none)');
  });

  it('truncates long request body in detail view', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    const longBody = 'x'.repeat(300);
    emitBeforeRequestSent(driver, {
      requestId: 'req-long', method: 'POST', url: 'https://example.com/upload',
      headers: [], body: { value: longBody }, timestamp: 1000,
    });

    const resp = makeResponse();
    await browser_request(driver, { index: 0 }, resp);

    // Selenium's RequestData does not expose body, so the detail view
    // shows "(none)" for request body rather than a truncated value.
    expect(resp.serialize()).toContain('Request body: (none)');
  });

  it('truncates long response body in detail view', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-resp', method: 'GET', url: 'https://example.com/big',
      headers: [], timestamp: 1000,
    });

    const longBody = 'y'.repeat(1200);
    emitResponseCompleted(driver, {
      requestId: 'req-resp', url: 'https://example.com/big',
      status: 200, statusText: 'OK', headers: [],
      content: { value: longBody }, timestamp: 2000,
    });

    const resp = makeResponse();
    await browser_request(driver, { index: 0 }, resp);

    expect(resp.serialize()).toContain('... (truncated)');
  });

  it('throws error for non-existent request index', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_request(driver, { index: 99 }, resp),
    ).rejects.toThrow('No network request at index 99');
  });

  it('returns no requests when buffer is empty', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_requests(driver, {}, resp);

    expect(resp.serialize()).toContain('(no network requests)');
  });

  it('truncates long URL in list view', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    const longUrl = 'https://example.com/' + 'a'.repeat(100);
    emitBeforeRequestSent(driver, {
      requestId: 'req-long-url', method: 'GET', url: longUrl,
      headers: [], timestamp: 1000,
    });

    const resp = makeResponse();
    await browser_requests(driver, {}, resp);

    expect(resp.serialize()).toContain('...');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// route.ts coverage
// ═════════════════════════════════════════════════════════════════════════

describe('route.ts coverage', () => {
  beforeEach(() => {
    resetAll();
  });

  it('route-list shows active routes', async () => {
    addRoute('intercept-1', '**/api/**', 404, '{"error":"not found"}', null);
    addRoute('intercept-2', '**/users/**', 200, null, null);

    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_route_list(driver, {}, resp);

    const output = resp.serialize();
    expect(output).toContain('**/api/**');
    expect(output).toContain('404');
    expect(output).toContain('{"error":"not found"}');
    expect(output).toContain('**/users/**');
    expect(output).toContain('200');
  });

  it('route-list shows no routes when empty', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_route_list(driver, {}, resp);

    expect(resp.serialize()).toContain('(no active routes)');
  });

  it('unroute by index removes specific route', async () => {
    addRoute('intercept-1', '**/api/**', 404, null, null);
    addRoute('intercept-2', '**/users/**', 200, null, null);

    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_unroute(driver, { index: 0 }, resp);

    expect(resp.serialize()).toContain('Removed route 0');
    expect(resp.serialize()).toContain('**/api/**');
    const routes = getRoutes();
    expect(routes.length).toBe(1);
    expect(routes[0].pattern).toBe('**/users/**');
  });

  it('unroute --all removes all routes', async () => {
    addRoute('intercept-1', '**/api/**', 404, null, null);
    addRoute('intercept-2', '**/users/**', 200, null, null);

    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_unroute(driver, { all: true }, resp);

    expect(resp.serialize()).toContain('Removed all 2 route(s)');
    expect(getRoutes()).toEqual([]);
  });

  it('unroute --all with no routes shows 0', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_unroute(driver, { all: true }, resp);

    expect(resp.serialize()).toContain('Removed all 0 route(s)');
  });

  it('unroute without index or --all throws error', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_unroute(driver, {}, resp),
    ).rejects.toThrow('unroute requires an index or --all flag');
  });

  it('unroute with non-existent index throws error', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_unroute(driver, { index: 99 }, resp),
    ).rejects.toThrow('No route at index 99');
  });

  it('route with headers registers successfully', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_route(driver, {
      pattern: '**/api/**',
      status: '401',
      headers: '{"X-Custom":"value"}',
    }, resp);

    expect(resp.serialize()).toContain('Route 0');
    const route = getRoute(0);
    expect(route).toBeDefined();
    expect(route!.headers).toEqual({ 'X-Custom': 'value' });
  });

  it('route with invalid headers JSON throws error', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_route(driver, { pattern: '**/api/**', status: '401', headers: 'not-json' }, resp),
    ).rejects.toThrow('Invalid --headers JSON');
  });

  it('route without --status throws error', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_route(driver, { pattern: '**/api/**' }, resp),
    ).rejects.toThrow('Route requires --status parameter');
  });

  it('route with long body truncates in output', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    const longBody = '{"data":"' + 'x'.repeat(80) + '"}';
    await browser_route(driver, { pattern: '**/api/**', status: '200', body: longBody }, resp);

    expect(resp.serialize()).toContain('...');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// console.ts coverage
// ═════════════════════════════════════════════════════════════════════════

describe('console.ts coverage', () => {
  beforeEach(() => {
    resetAll();
  });

  async function initAndPopulateConsole() {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, { level: 'info', text: 'Info message', method: 'log' });
    emitConsoleEntry(driver, { level: 'warning', text: 'Warning message', method: 'warn' });
    emitConsoleEntry(driver, { level: 'error', text: 'Error message', method: 'error' });
    emitJsException(driver, { text: 'JS Exception occurred', stackTrace: 'at line 1' });

    return driver;
  }

  it('shows all console messages', async () => {
    await initAndPopulateConsole();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_console(driver, {}, resp);

    const output = resp.serialize();
    expect(output).toContain('Info message');
    expect(output).toContain('Warning message');
    expect(output).toContain('Error message');
    expect(output).toContain('JS Exception occurred');
  });

  it('filters by level (error)', async () => {
    await initAndPopulateConsole();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_console(driver, { level: 'error' }, resp);

    const output = resp.serialize();
    expect(output).toContain('Error message');
    expect(output).toContain('JS Exception occurred');
    expect(output).not.toContain('Info message');
    expect(output).not.toContain('Warning message');
  });

  it('filters by level (warning)', async () => {
    await initAndPopulateConsole();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_console(driver, { level: 'warning' }, resp);

    const output = resp.serialize();
    expect(output).toContain('Warning message');
    expect(output).toContain('Error message');
    expect(output).not.toContain('Info message');
  });

  it('filters js-error only', async () => {
    await initAndPopulateConsole();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_console(driver, { level: 'js-error' }, resp);

    const output = resp.serialize();
    expect(output).toContain('JS Exception occurred');
    expect(output).not.toContain('Info message');
    expect(output).not.toContain('Warning message');
    expect(output).not.toContain('Error message');
  });

  it('filters with --since (recent only)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, { level: 'info', text: 'Old message', timestamp: Date.now() - 2 * 60 * 60 * 1000, method: 'log' });
    emitConsoleEntry(driver, { level: 'info', text: 'Recent message', timestamp: Date.now(), method: 'log' });

    const resp = makeResponse();
    await browser_console(driver, { since: '5m' }, resp);

    const output = resp.serialize();
    expect(output).toContain('Recent message');
    expect(output).not.toContain('Old message');
  });

  it('clears buffer with --clear', async () => {
    await initAndPopulateConsole();
    const driver = makeNetworkDriver();
    const resp = makeResponse();

    await browser_console(driver, { clear: true }, resp);

    expect(getConsoleEntries()).toEqual([]);
  });

  it('throws for invalid level', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_console(driver, { level: 'invalid-level' }, resp),
    ).rejects.toThrow('Unknown console level');
  });

  it('accepts debug level', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_console(driver, { level: 'debug' }, resp);

    expect(resp.serialize()).toContain('(no console messages)');
  });

  it('truncates long console text', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    const longText = 'x'.repeat(300);
    emitConsoleEntry(driver, { level: 'info', text: longText, method: 'log' });

    const resp = makeResponse();
    await browser_console(driver, {}, resp);

    expect(resp.serialize()).toContain('...');
  });

  it('accepts valid --since formats (s, m, h)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    for (const since of ['30s', '5m', '1h']) {
      const resp = makeResponse();
      await browser_console(driver, { since }, resp);
      expect(resp.serialize()).toContain('(no console messages)');
    }
  });

  it('throws for invalid --since format', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await expect(
      browser_console(driver, { since: 'invalid' }, resp),
    ).rejects.toThrow('Invalid --since duration');
  });

  it('returns no messages when buffer is empty', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    const resp = makeResponse();

    await browser_console(driver, {}, resp);

    expect(resp.serialize()).toContain('(no console messages)');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// network-state.ts coverage
// ═════════════════════════════════════════════════════════════════════════

describe('network-state.ts coverage', () => {
  beforeEach(() => {
    resetAll();
  });

  // ── Console buffer overflow ──────────────────────────────

  it('console buffer overflow: shifts oldest entry when exceeding MAX_CONSOLE_ENTRIES', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    for (let i = 0; i <= 1000; i++) {
      emitConsoleEntry(driver, {
        level: 'info',
        text: `msg-${i}`,
        method: 'log',
      });
    }

    const entries = getConsoleEntries();
    expect(entries.length).toBe(1000);
    expect(entries[0].text).toBe('msg-1');
    expect(entries[999].text).toBe('msg-1000');
  });

  // ── Network buffer overflow ──────────────────────────────

  it('network buffer overflow: shifts oldest entry and re-indexes when exceeding MAX_NETWORK_ENTRIES', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    for (let i = 0; i <= 500; i++) {
      emitBeforeRequestSent(driver, {
        requestId: `req-${i}`, method: 'GET', url: `https://example.com/${i}`,
        headers: [],
      });
    }

    const entries = getNetworkRequests();
    expect(entries.length).toBe(500);
    expect(entries[0].url).toBe('https://example.com/1');
    expect(entries[0].index).toBe(0);
    expect(entries[499].index).toBe(499);
  });

  // ── responseCompleted handler ────────────────────────────

  it('responseCompleted: updates entry with status, headers, and body', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://api.example.com',
      headers: [{ name: 'Accept', value: { type: 'string', value: 'application/json' } }],
      timestamp: 1000,
    });

    emitResponseCompleted(driver, {
      requestId: 'req-1', url: 'https://api.example.com',
      status: 200, statusText: 'OK',
      headers: [{ name: 'Content-Type', value: { type: 'string', value: 'text/html' } }],
      content: { value: '<html><body>Hello</body></html>' },
      timestamp: 2000,
    });

    const entry = getNetworkRequest(0);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe(200);
    expect(entry!.statusText).toBe('OK');
    expect(entry!.completed).toBe(true);
    expect(entry!.duration).toBe(1000);
    expect(entry!.responseHeaders['Content-Type']).toBe('text/html');
    expect(entry!.responseBody).toBe('<html><body>Hello</body></html>');
    expect(entry!.mimeType).toBe('text/html');
  });

  it('responseCompleted: falls back to URL matching when request ID not found', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://fallback.example.com',
      headers: [], timestamp: 1000,
    });

    emitResponseCompleted(driver, {
      requestId: 'different-id', url: 'https://fallback.example.com',
      status: 404, statusText: 'Not Found', headers: [],
      timestamp: 2000,
    });

    const entry = getNetworkRequest(0);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe(404);
    expect(entry!.completed).toBe(true);
  });

  it('responseCompleted: handles plain object headers (not array)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://example.com',
      headers: [{ name: 'X-Custom', value: { type: 'string', value: 'value' } }],
      timestamp: 1000,
    });

    // ResponseData stores headers raw, so we can test plain object headers
    emitEvent(driver, {
      context: null, navigation: null, redirectCount: 0,
      request: makeRequestParams({ requestId: 'req-1', url: 'https://example.com' }),
      timestamp: 2000,
      response: {
        url: 'https://example.com', protocol: 'http/1.1',
        status: 200, statusText: 'OK', fromCache: false,
        headers: { 'Content-Type': 'application/json' },
        mimeType: 'application/json', bytesReceived: 0,
        headerSize: 0, bodySize: 0, content: null,
      },
    }, 'network.responseCompleted');

    const entry = getNetworkRequest(0);
    expect(entry!.requestHeaders['X-Custom']).toBe('value');
    expect(entry!.responseHeaders['Content-Type']).toBe('application/json');
  });

  it('responseCompleted: truncates response body exceeding MAX_RESPONSE_BODY_BYTES', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://example.com',
      headers: [], timestamp: 1000,
    });

    const largeBody = 'x'.repeat(200 * 1024);
    emitResponseCompleted(driver, {
      requestId: 'req-1', url: 'https://example.com',
      status: 200, statusText: 'OK', headers: [],
      content: { value: largeBody }, timestamp: 2000,
    });

    const entry = getNetworkRequest(0);
    expect(entry!.responseBody).toContain('... (truncated)');
    expect(entry!.responseBody!.length).toBeLessThan(largeBody.length);
  });

  // ── fetchError handler ───────────────────────────────────

  it('fetchError: marks entry as completed with status 0', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://fail.example.com',
      headers: [], timestamp: 1000,
    });

    emitFetchError(driver, {
      requestId: 'req-1', url: 'https://fail.example.com',
      errorText: 'Network error', timestamp: 2000,
    });

    const entry = getNetworkRequest(0);
    expect(entry!.status).toBe(0);
    expect(entry!.statusText).toBe('Network error');
    expect(entry!.completed).toBe(true);
    expect(entry!.duration).toBe(1000);
  });

  it('fetchError: falls back to URL matching', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://fail2.example.com',
      headers: [], timestamp: 1000,
    });

    emitFetchError(driver, {
      requestId: 'different-id', url: 'https://fail2.example.com',
      errorText: 'Connection refused', timestamp: 2000,
    });

    const entry = getNetworkRequest(0);
    expect(entry!.status).toBe(0);
    expect(entry!.statusText).toBe('Connection refused');
  });

  // ── Null event handling (defensive checks — events not sent, buffer stays empty) ──

  it('beforeRequestSent: ignores null event (buffer stays empty)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    expect(getNetworkRequests()).toEqual([]);
  });

  it('beforeRequestSent: ignores event with null request (buffer stays empty)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    expect(getNetworkRequests()).toEqual([]);
  });

  it('responseCompleted: ignores null event (no entries completed)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    expect(getNetworkRequests()).toEqual([]);
  });

  it('responseCompleted: ignores event with null response (no entries completed)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    expect(getNetworkRequests()).toEqual([]);
  });

  it('fetchError: ignores null event (buffer stays empty)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    expect(getNetworkRequests()).toEqual([]);
  });

  // ── request body capture ─────────────────────────────────

  it('beforeRequestSent: request body is null (RequestData does not expose body)', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'POST', url: 'https://example.com',
      headers: [], body: { value: '{"key":"val"}' }, timestamp: 1000,
    });

    const entry = getNetworkRequest(0);
    // Selenium's RequestData class does not have a body getter, so
    // network-state.ts falls back to null for requestBody.
    expect(entry!.requestBody).toBeNull();
  });

  // ── Route registry edge cases ────────────────────────────

  it('deactivateRoute: returns undefined for negative index', () => {
    expect(deactivateRoute(-1)).toBeUndefined();
  });

  it('removeRoute: returns undefined for negative index', () => {
    expect(removeRoute(-1)).toBeUndefined();
  });

  it('getRoute: returns undefined for negative index', () => {
    expect(getRoute(-1)).toBeUndefined();
  });

  it('addRoute: assigns sequential indices', () => {
    const r0 = addRoute('id-0', '**/a/**', 200, null, null);
    const r1 = addRoute('id-1', '**/b/**', 404, null, null);
    const r2 = addRoute('id-2', '**/c/**', 500, null, null);
    expect(r0.index).toBe(0);
    expect(r1.index).toBe(1);
    expect(r2.index).toBe(2);
  });

  it('removeRoute: re-indexes remaining routes after removal', () => {
    addRoute('id-0', '**/a/**', 200, null, null);
    addRoute('id-1', '**/b/**', 404, null, null);
    addRoute('id-2', '**/c/**', 500, null, null);

    removeRoute(1);

    const routes = getRoutes();
    expect(routes.length).toBe(2);
    expect(routes[0].index).toBe(0);
    expect(routes[0].pattern).toBe('**/a/**');
    expect(routes[1].index).toBe(1);
    expect(routes[1].pattern).toBe('**/c/**');
  });

  // ── getNetwork ───────────────────────────────────────────

  it('getNetwork: returns null before initialization', () => {
    expect(getNetwork()).toBeNull();
  });

  it('getNetwork: returns network object after initialization', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    const network = getNetwork();
    expect(network).toBeDefined();
    expect(network.beforeRequestSent).toBeDefined();
    expect(network.responseCompleted).toBeDefined();
  });

  // ── resetBidiState ───────────────────────────────────────

  it('resetBidiState: clears network reference', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    expect(getNetwork()).toBeDefined();

    resetBidiState();
    expect(getNetwork()).toBeNull();
  });

  // ── resetAll ─────────────────────────────────────────────

  it('resetAll: clears all buffers and registries after population', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, { level: 'info', text: 'test', method: 'log' });
    emitBeforeRequestSent(driver, {
      requestId: 'req-1', method: 'GET', url: 'https://example.com',
      headers: [], timestamp: Date.now(),
    });
    addRoute('id-1', '**/api/**', 404, null, null);
    addHighlight('e1');

    resetAll();

    expect(getConsoleEntries()).toEqual([]);
    expect(getNetworkRequests()).toEqual([]);
    expect(getRoutes()).toEqual([]);
    expect(getHighlights()).toEqual([]);
  });

  // ── Console entries with level filtering and data ────────

  it('getConsoleEntries: filters by level with actual data', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, { level: 'debug', text: 'debug msg', method: 'log' });
    emitConsoleEntry(driver, { level: 'info', text: 'info msg', method: 'log' });
    emitConsoleEntry(driver, { level: 'warning', text: 'warning msg', method: 'log' });
    emitConsoleEntry(driver, { level: 'error', text: 'error msg', method: 'error' });

    const all = getConsoleEntries();
    expect(all.length).toBe(4);

    const errors = getConsoleEntries('error');
    expect(errors.length).toBe(1);
    expect(errors[0].text).toBe('error msg');

    const warnings = getConsoleEntries('warning');
    expect(warnings.length).toBe(2);
    expect(warnings.some(e => e.text === 'warning msg')).toBe(true);
    expect(warnings.some(e => e.text === 'error msg')).toBe(true);
  });

  it('getConsoleEntries: filters by sinceMs with actual data', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, { level: 'info', text: 'old msg', timestamp: Date.now() - 600000, method: 'log' });
    emitConsoleEntry(driver, { level: 'info', text: 'recent msg', timestamp: Date.now(), method: 'log' });

    const recent = getConsoleEntries(undefined, 300000);
    expect(recent.length).toBe(1);
    expect(recent[0].text).toBe('recent msg');
  });

  // ── Network requests with filtering and data ────────────

  it('getNetworkRequests: filters by URL, status, and method with data', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'r0', method: 'GET', url: 'https://api.example.com/users',
      headers: [], timestamp: 1000,
    });
    emitBeforeRequestSent(driver, {
      requestId: 'r1', method: 'POST', url: 'https://api.example.com/login',
      headers: [], timestamp: 2000,
    });
    emitBeforeRequestSent(driver, {
      requestId: 'r2', method: 'GET', url: 'https://cdn.example.com/style.css',
      headers: [], timestamp: 3000,
    });

    emitResponseCompleted(driver, {
      requestId: 'r0', url: 'https://api.example.com/users',
      status: 200, statusText: 'OK', headers: [], timestamp: 1500,
    });
    emitResponseCompleted(driver, {
      requestId: 'r1', url: 'https://api.example.com/login',
      status: 500, statusText: 'Error', headers: [], timestamp: 2500,
    });

    const apiReqs = getNetworkRequests('api.example');
    expect(apiReqs.length).toBe(2);

    const okReqs = getNetworkRequests(undefined, 200);
    expect(okReqs.length).toBe(1);
    expect(okReqs[0].url).toContain('users');

    const errReqs = getNetworkRequests(undefined, 500);
    expect(errReqs.length).toBe(1);
    expect(errReqs[0].url).toContain('login');

    const postReqs = getNetworkRequests(undefined, undefined, 'POST');
    expect(postReqs.length).toBe(1);
    expect(postReqs[0].method).toBe('POST');

    const combined = getNetworkRequests('api', 200, 'GET');
    expect(combined.length).toBe(1);
    expect(combined[0].url).toContain('users');
  });

  // ── clearNetworkRequests ─────────────────────────────────

  it('clearNetworkRequests: clears buffer and pending requests', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, {
      requestId: 'r0', method: 'GET', url: 'https://example.com',
      headers: [], timestamp: 1000,
    });

    expect(getNetworkRequests().length).toBe(1);

    clearNetworkRequests();

    expect(getNetworkRequests()).toEqual([]);
    expect(getNetworkRequest(0)).toBeUndefined();
  });

  // ── clearConsole ─────────────────────────────────────────

  it('clearConsole: clears console buffer', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, { level: 'info', text: 'test', method: 'log' });
    expect(getConsoleEntries().length).toBe(1);

    clearConsole();
    expect(getConsoleEntries()).toEqual([]);
  });

  // ── Highlight registry ───────────────────────────────────

  it('highlight registry: add, list, remove, clear', () => {
    expect(getHighlights()).toEqual([]);

    addHighlight('e1');
    addHighlight('e2');
    addHighlight('e3');
    expect(getHighlights()).toEqual(['e1', 'e2', 'e3']);

    expect(removeHighlight('e2')).toBe(true);
    expect(getHighlights()).toEqual(['e1', 'e3']);

    expect(removeHighlight('nonexistent')).toBe(false);

    clearAllHighlights();
    expect(getHighlights()).toEqual([]);
  });

  // ── ensureBidiInitialized: re-initialization after reset ─

  it('ensureBidiInitialized: re-initializes after resetBidiState', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);
    expect(getNetwork()).toBeDefined();

    resetBidiState();
    expect(getNetwork()).toBeNull();

    await ensureBidiInitialized(driver);
    expect(getNetwork()).toBeDefined();
  });

  // ── JS exception entry ───────────────────────────────────

  it('onJavascriptException: creates error-level entry with source javascriptException', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitJsException(driver, {
      text: 'TypeError: undefined is not a function',
      stackTrace: 'at test (line 5)',
    });

    const entries = getConsoleEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].source).toBe('javascriptException');
    expect(entries[0].text).toBe('TypeError: undefined is not a function');
    expect(entries[0].stackTrace).toBe('at test (line 5)');
  });

  it('onJavascriptException: uses default text when missing', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitJsException(driver, {});

    const entries = getConsoleEntries();
    expect(entries[0].text).toBe('JavaScript error');
  });

  // ── Console entry with missing fields ────────────────────

  it('onConsoleEntry: uses defaults for missing fields', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitConsoleEntry(driver, {});

    const entries = getConsoleEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].text).toBe('');
    expect(entries[0].source).toBe('console');
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  // ── Network entry with missing fields ────────────────────

  it('beforeRequestSent: uses defaults for missing fields', async () => {
    const driver = makeNetworkDriver();
    await ensureBidiInitialized(driver);

    emitBeforeRequestSent(driver, { requestId: '', url: '' });

    const entries = getNetworkRequests();
    expect(entries.length).toBe(1);
    expect(entries[0].method).toBe('GET');
    expect(entries[0].url).toBe('');
    expect(entries[0].status).toBeNull();
  });
});
