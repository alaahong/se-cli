import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Response } from '../../src/response';
import { parseCommand } from '../../src/daemon/backend';

// Mock selenium-webdriver/bidi modules so ensureBidiInitialized succeeds
// without a real browser/driver.
vi.mock('selenium-webdriver/bidi/logInspector', () => {
  return vi.fn(async () => ({
    onConsoleEntry: vi.fn(async () => {}),
    onJavascriptException: vi.fn(async () => {}),
  }));
});

vi.mock('selenium-webdriver/bidi/network', () => {
  const mockNetwork = {
    beforeRequestSent: vi.fn(async () => {}),
    responseCompleted: vi.fn(async () => {}),
    fetchError: vi.fn(async () => {}),
    addIntercept: vi.fn(async () => 'mock-intercept-id'),
    removeIntercept: vi.fn(async () => {}),
    provideResponse: vi.fn(async () => {}),
    continueRequest: vi.fn(async () => {}),
  };
  return { Network: vi.fn(async () => mockNetwork) };
});

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

// Import after mocks are set up
import {
  resetAll,
  resetBidiState,
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
  addHighlight,
  removeHighlight,
  clearAllHighlights,
  getHighlights,
} from '../../src/daemon/tools/network-state';

import { browser_highlight } from '../../src/daemon/tools/highlight';
import { browser_console } from '../../src/daemon/tools/console';
import { browser_requests, browser_request } from '../../src/daemon/tools/requests';
import { browser_route, browser_route_list, browser_unroute } from '../../src/daemon/tools/route';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeResponse(): Response {
  return new Response({ raw: false, json: false });
}

function makeMockDriver(overrides: Record<string, any> = {}): any {
  const mockEl = { dataset: {} };
  return {
    executeScript: vi.fn(async (...args: any[]) => {
      // If the first arg is a function that queries for [data-se-highlight], return mockEl
      if (typeof args[0] === 'string' && args[0].includes('data-se-highlight')) {
        return undefined;
      }
      return undefined;
    }),
    findElement: vi.fn(async () => mockEl),
    switchTo: vi.fn(() => ({ defaultContent: vi.fn(async () => {}) })),
    ...overrides,
  };
}

// Since ensureBidiInitialized requires driver.getBidi(), we need to set bidiInitialized
// to true by calling ensureBidiInitialized once with a mock driver that has getBidi().
// But since we mocked the bidi modules, the require calls will return mocks.
// However, we still need driver.getBidi() to return a mock.
function makeBiDiMockDriver(overrides: Record<string, any> = {}): any {
  const driver = makeMockDriver(overrides);
  driver.getBidi = vi.fn(async () => ({
    subscribe: vi.fn(async () => {}),
    socket: Promise.resolve({
      on: vi.fn(),
    }),
    send: vi.fn(async (params: any) => {
      // Return intercept ID for addIntercept, empty result for others
      if (params.method === 'network.addIntercept') {
        return { result: { intercept: 'mock-intercept-id' } };
      }
      return { result: {} };
    }),
  }));
  return driver;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('v0.7 Network & Debugging', () => {
  beforeEach(() => {
    resetAll();
  });

  // ── parseCommand: v0.7 routing ───────────────────────────

  describe('parseCommand: highlight routing', () => {
    it('parses highlight <ref>', () => {
      const { toolName, toolParams } = parseCommand(['highlight', 'e1']);
      expect(toolName).toBe('browser_highlight');
      expect(toolParams.target).toBe('e1');
      expect(toolParams.hide).toBe(false);
      expect(toolParams.all).toBe(false);
    });

    it('parses highlight with --style', () => {
      const { toolParams } = parseCommand(['highlight', 'e1', '--style=2px solid blue']);
      expect(toolParams.style).toBe('2px solid blue');
    });

    it('parses highlight --hide --all', () => {
      const { toolParams } = parseCommand(['highlight', '--hide', '--all']);
      expect(toolParams.hide).toBe(true);
      expect(toolParams.all).toBe(true);
    });

    it('parses highlight <ref> --hide', () => {
      const { toolParams } = parseCommand(['highlight', 'e1', '--hide']);
      expect(toolParams.target).toBe('e1');
      expect(toolParams.hide).toBe(true);
    });

    it('parses highlight with no args', () => {
      const { toolParams } = parseCommand(['highlight']);
      expect(toolParams.target).toBeUndefined();
    });
  });

  describe('parseCommand: console routing', () => {
    it('parses console with no args', () => {
      const { toolName, toolParams } = parseCommand(['console']);
      expect(toolName).toBe('browser_console');
      expect(toolParams.level).toBeUndefined();
      expect(toolParams.clear).toBe(false);
    });

    it('parses console error', () => {
      const { toolParams } = parseCommand(['console', 'error']);
      expect(toolParams.level).toBe('error');
    });

    it('parses console js-error', () => {
      const { toolParams } = parseCommand(['console', 'js-error']);
      expect(toolParams.level).toBe('js-error');
    });

    it('parses console --since=5m', () => {
      const { toolParams } = parseCommand(['console', '--since=5m']);
      expect(toolParams.since).toBe('5m');
    });

    it('parses console --clear', () => {
      const { toolParams } = parseCommand(['console', '--clear']);
      expect(toolParams.clear).toBe(true);
    });
  });

  describe('parseCommand: requests routing', () => {
    it('parses requests with no args', () => {
      const { toolName, toolParams } = parseCommand(['requests']);
      expect(toolName).toBe('browser_requests');
      expect(toolParams.filter).toBeUndefined();
      expect(toolParams.status).toBeUndefined();
      expect(toolParams.method).toBeUndefined();
    });

    it('parses requests --filter="api"', () => {
      const { toolParams } = parseCommand(['requests', '--filter=api']);
      expect(toolParams.filter).toBe('api');
    });

    it('parses requests --status=500', () => {
      const { toolParams } = parseCommand(['requests', '--status=500']);
      expect(toolParams.status).toBe('500');
    });

    it('parses requests --method=POST', () => {
      const { toolParams } = parseCommand(['requests', '--method=POST']);
      expect(toolParams.method).toBe('POST');
    });

    it('parses requests --clear', () => {
      const { toolParams } = parseCommand(['requests', '--clear']);
      expect(toolParams.clear).toBe(true);
    });
  });

  describe('parseCommand: request routing', () => {
    it('parses request 0', () => {
      const { toolName, toolParams } = parseCommand(['request', '0']);
      expect(toolName).toBe('browser_request');
      expect(toolParams.index).toBe(0);
    });

    it('parses request 5', () => {
      const { toolParams } = parseCommand(['request', '5']);
      expect(toolParams.index).toBe(5);
    });
  });

  describe('parseCommand: route routing', () => {
    it('parses route <pattern>', () => {
      const { toolName, toolParams } = parseCommand(['route', '**/api/**']);
      expect(toolName).toBe('browser_route');
      expect(toolParams.pattern).toBe('**/api/**');
    });

    it('parses route with --status and --body', () => {
      const { toolParams } = parseCommand(['route', '**/api/**', '--status=401', '--body={"error":"invalid"}']);
      expect(toolParams.status).toBe('401');
      expect(toolParams.body).toBe('{"error":"invalid"}');
    });

    it('parses route with --headers', () => {
      const { toolParams } = parseCommand(['route', '**/api/**', '--headers={"Content-Type":"application/json"}']);
      expect(toolParams.headers).toBe('{"Content-Type":"application/json"}');
    });
  });

  describe('parseCommand: route-list routing', () => {
    it('parses route-list', () => {
      const { toolName, toolParams } = parseCommand(['route-list']);
      expect(toolName).toBe('browser_route_list');
      expect(toolParams).toEqual({});
    });
  });

  describe('parseCommand: unroute routing', () => {
    it('parses unroute <index>', () => {
      const { toolName, toolParams } = parseCommand(['unroute', '0']);
      expect(toolName).toBe('browser_unroute');
      expect(toolParams.index).toBe(0);
      expect(toolParams.all).toBe(false);
    });

    it('parses unroute --all', () => {
      const { toolParams } = parseCommand(['unroute', '--all']);
      expect(toolParams.all).toBe(true);
    });
  });

  // ── network-state: console buffer ────────────────────────

  describe('network-state: console buffer', () => {
    it('returns empty array initially', () => {
      expect(getConsoleEntries()).toEqual([]);
    });

    it('clears console buffer', () => {
      clearConsole();
      expect(getConsoleEntries()).toEqual([]);
    });

    it('filters by level', () => {
      // getConsoleEntries with level filter should not throw
      const entries = getConsoleEntries('error');
      expect(entries).toEqual([]);
    });

    it('filters by sinceMs', () => {
      const entries = getConsoleEntries(undefined, 5000);
      expect(entries).toEqual([]);
    });
  });

  // ── network-state: network buffer ───────────────────────

  describe('network-state: network request buffer', () => {
    it('returns empty array initially', () => {
      expect(getNetworkRequests()).toEqual([]);
    });

    it('returns undefined for out-of-range index', () => {
      expect(getNetworkRequest(0)).toBeUndefined();
      expect(getNetworkRequest(99)).toBeUndefined();
    });

    it('clears network buffer', () => {
      clearNetworkRequests();
      expect(getNetworkRequests()).toEqual([]);
    });

    it('filters by URL substring', () => {
      const entries = getNetworkRequests('api');
      expect(entries).toEqual([]);
    });

    it('filters by status code', () => {
      const entries = getNetworkRequests(undefined, 404);
      expect(entries).toEqual([]);
    });

    it('filters by method', () => {
      const entries = getNetworkRequests(undefined, undefined, 'GET');
      expect(entries).toEqual([]);
    });
  });

  // ── network-state: route registry ───────────────────────

  describe('network-state: route registry', () => {
    it('returns empty array initially', () => {
      expect(getRoutes()).toEqual([]);
    });

    it('adds a route and returns it with index 0', () => {
      const route = addRoute('intercept-1', '**/api/**', 404, null, null);
      expect(route.index).toBe(0);
      expect(route.interceptId).toBe('intercept-1');
      expect(route.pattern).toBe('**/api/**');
      expect(route.status).toBe(404);
    });

    it('lists routes after adding', () => {
      addRoute('intercept-1', '**/api/**', 404, null, null);
      addRoute('intercept-2', '**/users/**', 200, '{"ok":true}', null);
      const routes = getRoutes();
      expect(routes.length).toBe(2);
      expect(routes[0].pattern).toBe('**/api/**');
      expect(routes[1].pattern).toBe('**/users/**');
    });

    it('removes a route by index', () => {
      addRoute('intercept-1', '**/api/**', 404, null, null);
      addRoute('intercept-2', '**/users/**', 200, null, null);
      const removed = removeRoute(0);
      expect(removed).toBeDefined();
      expect(removed!.pattern).toBe('**/api/**');
      // After removal, remaining route should be re-indexed
      const routes = getRoutes();
      expect(routes.length).toBe(1);
      expect(routes[0].index).toBe(0);
      expect(routes[0].pattern).toBe('**/users/**');
    });

    it('returns undefined for out-of-range route removal', () => {
      expect(removeRoute(99)).toBeUndefined();
    });

    it('removes all routes', () => {
      addRoute('intercept-1', '**/api/**', 404, null, null);
      addRoute('intercept-2', '**/users/**', 200, null, null);
      const removed = removeAllRoutes();
      expect(removed.length).toBe(2);
      expect(getRoutes()).toEqual([]);
    });
  });

  // ── network-state: highlight registry ────────────────────

  describe('network-state: highlight registry', () => {
    it('returns empty array initially', () => {
      expect(getHighlights()).toEqual([]);
    });

    it('adds and lists highlights', () => {
      addHighlight('e1');
      addHighlight('e2');
      expect(getHighlights()).toEqual(['e1', 'e2']);
    });

    it('removes a highlight', () => {
      addHighlight('e1');
      addHighlight('e2');
      const removed = removeHighlight('e1');
      expect(removed).toBe(true);
      expect(getHighlights()).toEqual(['e2']);
    });

    it('returns false when removing non-existent highlight', () => {
      const removed = removeHighlight('e99');
      expect(removed).toBe(false);
    });

    it('clears all highlights', () => {
      addHighlight('e1');
      addHighlight('e2');
      clearAllHighlights();
      expect(getHighlights()).toEqual([]);
    });
  });

  // ── highlight tool ───────────────────────────────────────

  describe('browser_highlight tool', () => {
    it('lists highlights when no target given', async () => {
      const driver = makeMockDriver();
      const resp = makeResponse();
      await browser_highlight(driver, {}, resp);
      expect(resp.serialize()).toContain('No active highlights');
    });

    it('lists active highlights', async () => {
      addHighlight('e1');
      addHighlight('e2');
      const driver = makeMockDriver();
      const resp = makeResponse();
      await browser_highlight(driver, {}, resp);
      expect(resp.serialize()).toContain('Active highlights: e1, e2');
    });

    it('clears all highlights with --hide --all', async () => {
      addHighlight('e1');
      addHighlight('e2');
      const driver = makeMockDriver();
      const resp = makeResponse();
      await browser_highlight(driver, { hide: true, all: true }, resp);
      expect(resp.serialize()).toContain('All highlights cleared');
      expect(getHighlights()).toEqual([]);
    });

    it('removes single highlight with --hide', async () => {
      addHighlight('e1');
      const driver = makeMockDriver();
      const resp = makeResponse();
      await browser_highlight(driver, { target: 'e1', hide: true }, resp);
      expect(resp.serialize()).toContain('Removed highlight from e1');
      expect(getHighlights()).toEqual([]);
    });

    it('applies highlight to element', async () => {
      const driver = makeMockDriver();
      const resp = makeResponse();
      await browser_highlight(driver, { target: 'e1' }, resp);
      expect(resp.serialize()).toContain('Highlighted e1');
      expect(resp.serialize()).toContain('3px solid red');
      expect(getHighlights()).toContain('e1');
    });

    it('applies custom style', async () => {
      const driver = makeMockDriver();
      const resp = makeResponse();
      await browser_highlight(driver, { target: 'e1', style: '5px dashed blue' }, resp);
      expect(resp.serialize()).toContain('5px dashed blue');
    });
  });

  // ── console tool ────────────────────────────────────────

  describe('browser_console tool', () => {
    it('returns no messages when buffer is empty', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_console(driver, {}, resp);
      expect(resp.serialize()).toContain('(no console messages)');
    });

    it('throws error for unknown level', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_console(driver, { level: 'unknown' }, resp),
      ).rejects.toThrow('Unknown console level');
    });

    it('accepts valid levels', async () => {
      const driver = makeBiDiMockDriver();
      for (const level of ['verbose', 'info', 'warning', 'error', 'js-error']) {
        const resp = makeResponse();
        await browser_console(driver, { level }, resp);
        expect(resp.serialize()).toContain('(no console messages)');
      }
    });

    it('clears buffer with --clear', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_console(driver, { clear: true }, resp);
      // Should not throw
      expect(getConsoleEntries()).toEqual([]);
    });
  });

  // ── requests tool ───────────────────────────────────────

  describe('browser_requests tool', () => {
    it('returns no requests when buffer is empty', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_requests(driver, {}, resp);
      expect(resp.serialize()).toContain('(no network requests)');
    });

    it('clears buffer with --clear', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_requests(driver, { clear: true }, resp);
      expect(resp.serialize()).toContain('Network request buffer cleared');
    });
  });

  describe('browser_request tool', () => {
    it('throws error for non-existent request index', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_request(driver, { index: 0 }, resp),
      ).rejects.toThrow('No network request at index 0');
    });
  });

  // ── route tool ──────────────────────────────────────────

  describe('browser_route tool', () => {
    it('registers a route and returns info', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_route(driver, { pattern: '**/api/**', status: '404' }, resp);
      expect(resp.serialize()).toContain('Route 0');
      expect(resp.serialize()).toContain('**/api/**');
      expect(resp.serialize()).toContain('404');
      const routes = getRoutes();
      expect(routes.length).toBe(1);
    });

    it('registers route with body', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_route(
        driver,
        { pattern: '**/api/**', status: '200', body: '{"ok":true}' },
        resp,
      );
      expect(resp.serialize()).toContain('{"ok":true}');
    });

    it('throws error for invalid --headers JSON', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_route(driver, { pattern: '**/api/**', headers: 'not-json' }, resp),
      ).rejects.toThrow('Invalid --headers JSON');
    });
  });

  describe('browser_route_list tool', () => {
    it('returns no routes when empty', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_route_list(driver, {}, resp);
      expect(resp.serialize()).toContain('(no active routes)');
    });

    it('lists active routes', async () => {
      addRoute('intercept-1', '**/api/**', 404, null, null);
      addRoute('intercept-2', '**/users/**', 200, '{"ok":true}', null);
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_route_list(driver, {}, resp);
      const output = resp.serialize();
      expect(output).toContain('**/api/**');
      expect(output).toContain('404');
      expect(output).toContain('**/users/**');
      expect(output).toContain('200');
    });
  });

  describe('browser_unroute tool', () => {
    it('throws error when no index or --all given', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_unroute(driver, {}, resp),
      ).rejects.toThrow('unroute requires an index or --all flag');
    });

    it('throws error for non-existent route index', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_unroute(driver, { index: 99 }, resp),
      ).rejects.toThrow('No route at index 99');
    });

    it('removes all routes with --all', async () => {
      addRoute('intercept-1', '**/api/**', 404, null, null);
      addRoute('intercept-2', '**/users/**', 200, null, null);
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_unroute(driver, { all: true }, resp);
      expect(resp.serialize()).toContain('Removed all 2 route(s)');
      expect(getRoutes()).toEqual([]);
    });

    it('removes specific route by index', async () => {
      addRoute('mock-intercept-id', '**/api/**', 404, null, null);
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_unroute(driver, { index: 0 }, resp);
      expect(resp.serialize()).toContain('Removed route 0');
      expect(resp.serialize()).toContain('**/api/**');
      expect(getRoutes()).toEqual([]);
    });
  });

  // ── resetAll & resetBidiState ─────────────────────────

  describe('resetAll', () => {
    it('clears all state', () => {
      addHighlight('e1');
      addRoute('id-1', '**/api/**', 404, null, null);
      resetAll();
      expect(getHighlights()).toEqual([]);
      expect(getRoutes()).toEqual([]);
      expect(getConsoleEntries()).toEqual([]);
      expect(getNetworkRequests()).toEqual([]);
    });
  });

  describe('resetBidiState', () => {
    it('is exported and callable', () => {
      // Should not throw
      expect(() => resetBidiState()).not.toThrow();
    });

    it('clears routes and highlights after resetAll calls resetBidiState', () => {
      addHighlight('e1');
      addRoute('id-1', '**/api/**', 404, null, null);
      resetAll();
      expect(getHighlights()).toEqual([]);
      expect(getRoutes()).toEqual([]);
    });
  });

  // ── getRoute & deactivateRoute ─────────────────────────

  describe('getRoute', () => {
    it('returns route by index', () => {
      const route = addRoute('id-1', '**/api/**', 404, null, null);
      const found = getRoute(0);
      expect(found).toBeDefined();
      expect(found!.pattern).toBe('**/api/**');
      expect(found!.active).toBe(true);
    });

    it('returns undefined for out-of-range index', () => {
      expect(getRoute(99)).toBeUndefined();
    });
  });

  describe('deactivateRoute', () => {
    it('sets active to false', () => {
      addRoute('id-1', '**/api/**', 404, null, null);
      const deactivated = deactivateRoute(0);
      expect(deactivated).toBeDefined();
      expect(deactivated!.active).toBe(false);
    });

    it('returns undefined for out-of-range index', () => {
      expect(deactivateRoute(99)).toBeUndefined();
    });
  });

  // ── RouteEntry active field ────────────────────────────

  describe('RouteEntry active field', () => {
    it('new routes are active by default', () => {
      const route = addRoute('id-1', '**/api/**', 200, '{"ok":true}', null);
      expect(route.active).toBe(true);
    });
  });

  // ── browser_route: --status required ──────────────────

  describe('browser_route: --status required', () => {
    it('throws error when --status is not provided', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_route(driver, { pattern: '**/api/**' }, resp),
      ).rejects.toThrow('Route requires --status parameter');
    });
  });

  // ── browser_console: invalid --since ──────────────────

  describe('browser_console: --since validation', () => {
    it('throws error for invalid --since format', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await expect(
        browser_console(driver, { since: 'invalid' }, resp),
      ).rejects.toThrow('Invalid --since duration');
    });

    it('accepts valid --since formats (s, m, h)', async () => {
      const driver = makeBiDiMockDriver();
      for (const since of ['30s', '5m', '1h']) {
        const resp = makeResponse();
        await browser_console(driver, { since }, resp);
        expect(resp.serialize()).toContain('(no console messages)');
      }
    });
  });

  // ── browser_route: route with active field ────────────

  describe('browser_route: stores route with active=true', () => {
    it('newly registered route has active=true', async () => {
      const driver = makeBiDiMockDriver();
      const resp = makeResponse();
      await browser_route(driver, { pattern: '**/api/**', status: '404' }, resp);
      const route = getRoute(0);
      expect(route).toBeDefined();
      expect(route!.active).toBe(true);
    });
  });
});
