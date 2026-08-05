/**
 * v0.7: Network & Debugging state manager.
 *
 * Maintains daemon-level BiDi event listeners and in-memory buffers for:
 * - Console messages (console.log/error/warn/info)
 * - JavaScript errors (uncaught exceptions)
 * - Network requests (URL, method, status, headers, body)
 * - Active route intercepts (mock rules)
 *
 * BiDi listeners are initialized lazily on first use of any network/debug
 * command, and remain active for the daemon's lifetime.
 */

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Simple glob matching compatible with BiDi string patterns.
 * In BiDi, `*` matches ANY characters (including `/`), `?` matches
 * a single character. This differs from shell glob where `*` excludes `/`.
 * The pattern must match the ENTIRE URL (anchored), so `?` is exactly one
 * character and a trailing pattern cannot match a longer URL prefix.
 */
export function matchesGlob(url: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
    .replace(/\*/g, '.*')   // * → .* (any characters including /)
    .replace(/\?/g, '.');    // ? → . (single char)
  return new RegExp('^' + regex + '$', 'i').test(url);
}

// ── Types ──────────────────────────────────────────────────────────────

export interface ConsoleEntry {
  level: string;       // 'info' | 'warning' | 'error' | 'debug' | 'verbose'
  text: string;
  timestamp: number;   // epoch ms
  source: string;      // 'console' | 'javascript' | 'javascriptException'
  method?: string;     // console method: log, error, warn, info
  stackTrace?: string;
}

export interface NetworkRequestEntry {
  index: number;
  requestId: string;
  method: string;
  url: string;
  status: number | null;
  statusText: string;
  mimeType: string;
  timestamp: number;
  duration: number | null;   // ms (responseCompleted - beforeRequestSent)
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  completed: boolean;
}

export interface RouteEntry {
  index: number;
  interceptId: string;
  pattern: string;
  status: number | null;
  body: string | null;
  headers: Record<string, string> | null;
  active: boolean;  // false after unroute — handler skips inactive routes
}

// ── State ──────────────────────────────────────────────────────────────

const MAX_CONSOLE_ENTRIES = 1000;
const MAX_NETWORK_ENTRIES = 500;
const MAX_RESPONSE_BODY_BYTES = 100 * 1024; // 100KB

let logInspector: any = null;
let network: any = null;
let bidi: any = null;
let bidiInitialized = false;
let initPromise: Promise<void> | null = null;

const consoleBuffer: ConsoleEntry[] = [];
const networkBuffer: NetworkRequestEntry[] = [];
const routeRegistry: RouteEntry[] = [];
const highlightRegistry: Set<string> = new Set();

// Map BiDi request IDs to network buffer entries for correlation
const pendingRequests: Map<string, NetworkRequestEntry> = new Map();

// ── Initialization ─────────────────────────────────────────────────────

/**
 * Initialize BiDi event listeners. Called lazily on first network/debug command.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function ensureBidiInitialized(driver: any): Promise<void> {
  if (bidiInitialized) return;
  if (initPromise) return initPromise;

  initPromise = doInit(driver).catch((e) => {
    // Reset on failure so next attempt can retry
    bidiInitialized = false;
    initPromise = null;
    throw e;
  });

  await initPromise;
  initPromise = null;
}

async function doInit(driver: any): Promise<void> {
  // Initialize LogInspector for console + JS errors
  const getLogInspectorInstance = require('selenium-webdriver/bidi/logInspector');
  logInspector = await getLogInspectorInstance(driver);

  // Subscribe to console entries
  await logInspector.onConsoleEntry((entry: any) => {
    pushConsoleEntry({
      level: entry.level || 'info',
      text: entry.text || '',
      timestamp: entry.timestamp || Date.now(),
      source: 'console',
      method: entry.method,
      stackTrace: entry.stackTrace,
    });
  });

  // Subscribe to JS exceptions
  await logInspector.onJavascriptException((entry: any) => {
    pushConsoleEntry({
      level: 'error',
      text: entry.text || 'JavaScript error',
      timestamp: entry.timestamp || Date.now(),
      source: 'javascriptException',
      stackTrace: entry.stackTrace,
    });
  });

  // Initialize Network for requests + routes
  const { Network: getNetworkInstance } = require('selenium-webdriver/bidi/network');
  network = await getNetworkInstance(driver);

  // Cache the BiDi connection for direct command sending (route intercepts,
  // provideResponse, continueRequest). This avoids the selenium-webdriver
  // wrapper which crashes on error responses (e.g., "Cannot read properties
  // of undefined (reading 'intercept')" when the browser doesn't support
  // network.addIntercept).
  bidi = await driver.getBidi();

  // Subscribe to beforeRequestSent
  // Selenium BiDi wraps raw events in BeforeRequestSent/ResponseStarted objects:
  //   event.request is a RequestData instance with:
  //     .request = request ID string
  //     .url, .method, .headers (array of Header instances)
  //
  // This handler serves double duty:
  //   1. Route interception — if an active route matches the URL, provide a
  //      mock response via BiDi and skip tracking.
  //   2. Request tracking — add to the network buffer for later retrieval.
  await network.beforeRequestSent(async (event: any) => {
    if (!event || !event.request) return;
    const req = event.request;
    const url = req.url || '';

    // ── Route interception ──────────────────────────────
    // Check active routes before tracking. If a route matches, provide
    // a mock response and skip tracking the request.
    const matchedRoute = getRoutes().find(r => r.active && matchesGlob(url, r.pattern));
    if (matchedRoute && matchedRoute.status !== null && bidi) {
      const requestId = req.request || req.id;
      try {
        const params: Record<string, any> = {
          request: requestId,
          statusCode: matchedRoute.status,
        };
        if (matchedRoute.body) {
          params.body = { type: 'string', value: matchedRoute.body };
        }
        if (matchedRoute.headers) {
          params.headers = Object.entries(matchedRoute.headers).map(
            ([k, v]) => ({ name: k, value: { type: 'string', value: v } }),
          );
        }
        await bidi.send({ method: 'network.provideResponse', params });
      } catch {
        // If providing response fails, continue the request normally
        try {
          await bidi.send({
            method: 'network.continueRequest',
            params: { request: requestId },
          });
        } catch {
          // Ignore — request will timeout
        }
      }
      return; // Don't track intercepted requests
    }

    // ── Request tracking ────────────────────────────────
    // Normalize headers: Selenium wraps them as Header[] instances,
    // but raw BiDi events may provide plain objects. Handle both.
    let rawHeaders: Record<string, string> = {};
    if (Array.isArray(req.headers)) {
      for (const h of req.headers) {
        if (h && h.name) {
          const val = h.value?.value ?? h.value ?? '';
          rawHeaders[h.name] = typeof val === 'string' ? val : String(val);
        }
      }
    } else if (req.headers && typeof req.headers === 'object') {
      rawHeaders = req.headers;
    }
    const entry: NetworkRequestEntry = {
      index: networkBuffer.length,
      requestId: req.request || req.id || String(event.timestamp),
      method: req.method || 'GET',
      url: req.url || '',
      status: null,
      statusText: '',
      mimeType: '',
      timestamp: event.timestamp || Date.now(),
      duration: null,
      requestHeaders: rawHeaders,
      requestBody: req.body?.value || null,
      responseHeaders: {},
      responseBody: null,
      completed: false,
    };
    pendingRequests.set(entry.requestId, entry);
    pushNetworkEntry(entry);
  });

  // Subscribe to responseCompleted
  // event.response is a ResponseData instance with:
  //   .status, .statusText, .mimeType, .headers (array or object)
  //   event.request is a RequestData with .request = request ID
  await network.responseCompleted((event: any) => {
    if (!event || !event.response) return;
    const resp = event.response;
    const req = event.request;
    const requestId = req?.request || req?.id;
    // Try to find the pending request by ID
    let entry = requestId ? pendingRequests.get(requestId) : undefined;
    if (!entry) {
      // Fallback: find by URL match in recent entries
      const url = req?.url || '';
      entry = networkBuffer
        .filter(e => !e.completed && e.url === url)
        .pop();
    }
    if (entry) {
      entry.status = resp.status || null;
      entry.statusText = resp.statusText || '';
      // Normalize response headers (same approach as request headers)
      let rawRespHeaders: Record<string, string> = {};
      if (Array.isArray(resp.headers)) {
        for (const h of resp.headers) {
          if (h && h.name) {
            const val = h.value?.value ?? h.value ?? '';
            rawRespHeaders[h.name] = typeof val === 'string' ? val : String(val);
          }
        }
      } else if (resp.headers && typeof resp.headers === 'object') {
        rawRespHeaders = resp.headers;
      }
      entry.mimeType = rawRespHeaders['content-type'] || resp.mimeType || '';
      entry.responseHeaders = rawRespHeaders;
      entry.completed = true;
      entry.duration = (event.timestamp || Date.now()) - entry.timestamp;
      // Truncate response body to prevent memory growth
      let body = resp.body?.value || resp.content?.value || null;
      if (body && body.length > MAX_RESPONSE_BODY_BYTES) {
        body = body.slice(0, MAX_RESPONSE_BODY_BYTES) + '... (truncated)';
      }
      entry.responseBody = body;
      pendingRequests.delete(entry.requestId);
    }
  });

  // Subscribe to fetchError
  await network.fetchError((event: any) => {
    if (!event) return;
    const req = event.request;
    const requestId = req?.request || req?.id;
    let entry = requestId ? pendingRequests.get(requestId) : undefined;
    if (!entry) {
      const url = req?.url || '';
      entry = networkBuffer
        .filter(e => !e.completed && e.url === url)
        .pop();
    }
    if (entry) {
      entry.completed = true;
      entry.status = 0;
      entry.statusText = event.errorText || 'Fetch error';
      entry.duration = (event.timestamp || Date.now()) - entry.timestamp;
      pendingRequests.delete(entry.requestId);
    }
  });

  bidiInitialized = true;
}

// ── Buffer Management ─────────────────────────────────────────────────

function pushConsoleEntry(entry: ConsoleEntry): void {
  consoleBuffer.push(entry);
  if (consoleBuffer.length > MAX_CONSOLE_ENTRIES) {
    consoleBuffer.shift();
  }
}

function pushNetworkEntry(entry: NetworkRequestEntry): void {
  entry.index = networkBuffer.length;
  networkBuffer.push(entry);
  if (networkBuffer.length > MAX_NETWORK_ENTRIES) {
    const removed = networkBuffer.shift();
    if (removed) {
      pendingRequests.delete(removed.requestId);
    }
    // Re-index remaining entries
    for (let i = 0; i < networkBuffer.length; i++) {
      networkBuffer[i].index = i;
    }
  }
}

// ── Console API ────────────────────────────────────────────────────────

export function getConsoleEntries(
  level?: string,
  sinceMs?: number,
): ConsoleEntry[] {
  let entries = [...consoleBuffer];
  if (level) {
    const levelOrder = ['verbose', 'debug', 'info', 'warning', 'error'];
    const minIdx = levelOrder.indexOf(level.toLowerCase());
    if (minIdx >= 0) {
      entries = entries.filter(e => {
        const eIdx = levelOrder.indexOf(e.level.toLowerCase());
        return eIdx >= minIdx;
      });
    }
  }
  if (sinceMs !== undefined) {
    const cutoff = Date.now() - sinceMs;
    entries = entries.filter(e => e.timestamp >= cutoff);
  }
  return entries;
}

export function clearConsole(): void {
  consoleBuffer.length = 0;
}

// ── Network Requests API ───────────────────────────────────────────────

export function getNetworkRequests(
  filter?: string,
  statusFilter?: number,
  methodFilter?: string,
): NetworkRequestEntry[] {
  let entries = [...networkBuffer];
  if (filter) {
    entries = entries.filter(e => e.url.includes(filter));
  }
  if (statusFilter !== undefined) {
    entries = entries.filter(e => e.status === statusFilter);
  }
  if (methodFilter) {
    entries = entries.filter(e => e.method.toUpperCase() === methodFilter.toUpperCase());
  }
  return entries;
}

export function getNetworkRequest(index: number): NetworkRequestEntry | undefined {
  return networkBuffer[index];
}

export function clearNetworkRequests(): void {
  networkBuffer.length = 0;
  pendingRequests.clear();
}

// ── Route Registry API ─────────────────────────────────────────────────

export function addRoute(
  interceptId: string,
  pattern: string,
  status: number | null,
  body: string | null,
  headers: Record<string, string> | null,
): RouteEntry {
  const entry: RouteEntry = {
    index: routeRegistry.length,
    interceptId,
    pattern,
    status,
    body,
    headers,
    active: true,
  };
  routeRegistry.push(entry);
  return entry;
}

export function getRoutes(): RouteEntry[] {
  return [...routeRegistry];
}

export function getRoute(index: number): RouteEntry | undefined {
  return routeRegistry[index];
}

export function deactivateRoute(index: number): RouteEntry | undefined {
  if (index < 0 || index >= routeRegistry.length) return undefined;
  routeRegistry[index].active = false;
  return routeRegistry[index];
}

export function removeRoute(index: number): RouteEntry | undefined {
  if (index < 0 || index >= routeRegistry.length) return undefined;
  const [removed] = routeRegistry.splice(index, 1);
  // Re-index remaining routes
  for (let i = 0; i < routeRegistry.length; i++) {
    routeRegistry[i].index = i;
  }
  return removed;
}

export function removeAllRoutes(): RouteEntry[] {
  const removed = [...routeRegistry];
  routeRegistry.length = 0;
  return removed;
}

export function getNetwork(): any {
  return network;
}

// ── Highlight Registry API ─────────────────────────────────────────────

export function addHighlight(ref: string): void {
  highlightRegistry.add(ref);
}

export function removeHighlight(ref: string): boolean {
  return highlightRegistry.delete(ref);
}

export function clearAllHighlights(): void {
  highlightRegistry.clear();
}

export function getHighlights(): string[] {
  return [...highlightRegistry];
}

// ── Reset (called on driver reset/close) ──────────────────────────────

/**
 * Reset BiDi initialization state so the next network/debug command
 * re-initializes listeners on the new driver. Called when the driver
 * is rebuilt after a crash or timeout.
 */
export function resetBidiState(): void {
  bidiInitialized = false;
  initPromise = null;
  logInspector = null;
  network = null;
  bidi = null;
}

/**
 * Reset all network/debug state: buffers, registries, and BiDi init state.
 * Called on driver reset (DRIVER_ERROR/TIMEOUT) and on shutdown.
 */
export function resetAll(): void {
  resetBidiState();
  consoleBuffer.length = 0;
  networkBuffer.length = 0;
  pendingRequests.clear();
  routeRegistry.length = 0;
  highlightRegistry.clear();
}
