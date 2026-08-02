/**
 * v0.8 Device & Environment Emulation — core state + application logic.
 *
 * Open-time flags (--viewport, --user-agent, --locale, --color-scheme,
 * --timezone, --geolocation, --permissions) are set when the daemon starts.
 * They are persisted in the SessionConfig so a driver rebuild replays them
 * automatically.
 *
 * Browser support (matches the roadmap capability matrix):
 *   - Chrome/Edge: full support via CDP (Emulation.* / Network.* / Browser.*).
 *   - Firefox: viewport only, via WebDriver BiDi `browsingContext.setViewport`
 *     (CDP is not available in Firefox). Unsupported capabilities are skipped
 *     with a warning log instead of failing the daemon startup.
 */

export interface EmulationViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  hasTouch?: boolean;
}

export interface EmulationGeolocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface EmulationThrottleNetwork {
  download?: number; // kbps
  upload?: number; // kbps
  latency?: number; // ms
}

export interface EmulationState {
  viewport?: EmulationViewport;
  userAgent?: string;
  locale?: string;
  colorScheme?: 'light' | 'dark';
  timezone?: string;
  geolocation?: EmulationGeolocation;
  permissions?: string[];
  // Runtime state set via `emulate` (v0.8) — also replayed on driver rebuild.
  offline?: boolean;
  throttleNetwork?: EmulationThrottleNetwork | null;
  throttleCpu?: number | null;
}

const state: EmulationState = {};

let cdpConnection: any = null;

export function setEmulationState(next: Partial<EmulationState>): void {
  // Replace semantics: clear stale keys (e.g. an `emulate --reset` after an
  // open with flags must remove viewport/UA, not just zero them out).
  for (const k of Object.keys(state)) delete (state as any)[k];
  Object.assign(state, next);
}

export function updateEmulationState(patch: Partial<EmulationState>): void {
  Object.assign(state, patch);
}

export function getEmulationState(): EmulationState {
  return state;
}

/**
 * Forget the cached CDP connection. Called when the driver is reset after a
 * crash — the emulation state itself is kept so a rebuilt driver replays it.
 */
export function resetEmulationState(): void {
  cdpConnection = null;
}

async function isChromium(driver: any): Promise<boolean> {
  const caps = await driver.getCapabilities();
  return (caps.get('browserName') || '') !== 'firefox';
}

/**
 * Get the cached CDP connection for a driver, creating it on first use.
 * Chrome/Edge only — Firefox throws (CDP support was removed upstream).
 */
async function getCdp(driver: any): Promise<any> {
  if (!cdpConnection) {
    cdpConnection = await driver.createCDPConnection('page');
  }
  return cdpConnection;
}

async function cdpSend(driver: any, method: string, params: any): Promise<void> {
  const conn = await getCdp(driver);
  const payload = await conn.send(method, params);
  if (payload && payload.error) {
    throw new Error(`${method}: ${payload.error.message}`);
  }
}

/**
 * Apply the current emulation state to a (possibly freshly built) driver.
 * Firefox: only viewport (BiDi). Unsupported capabilities are skipped.
 * Returns a list of warning strings for capabilities that were skipped.
 */
export async function applyEmulation(driver: any): Promise<string[]> {
  const warnings: string[] = [];
  const chromium = await isChromium(driver);

  if (state.viewport) {
    if (chromium) {
      await cdpSend(driver, 'Emulation.setDeviceMetricsOverride', {
        width: state.viewport.width,
        height: state.viewport.height,
        deviceScaleFactor: state.viewport.deviceScaleFactor ?? 1,
        mobile: state.viewport.mobile ?? false,
        hasTouch: state.viewport.hasTouch ?? false,
        screenWidth: state.viewport.width,
        screenHeight: state.viewport.height,
      });
    } else {
      // Firefox: BiDi browsingContext.setViewport (no mobile/touch flags).
      const bidi = await driver.getBidi();
      const context = await driver.getWindowHandle();
      const result = await bidi.send({
        method: 'browsingContext.setViewport',
        params: {
          context,
          viewport: { width: state.viewport.width, height: state.viewport.height },
          devicePixelRatio: state.viewport.deviceScaleFactor ?? 1,
        },
      });
      if (result && result.error) {
        throw new Error(`browsingContext.setViewport: ${result.error}`);
      }
    }
  }

  if (state.userAgent) {
    if (chromium) {
      await cdpSend(driver, 'Network.setUserAgentOverride', { userAgent: state.userAgent });
    } else {
      warnings.push('userAgent is not supported on Firefox');
    }
  }

  if (state.locale) {
    if (chromium) {
      await cdpSend(driver, 'Emulation.setLocaleOverride', { locale: state.locale });
    } else {
      warnings.push('locale is not supported on Firefox');
    }
  }

  if (state.colorScheme) {
    if (chromium) {
      await cdpSend(driver, 'Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: state.colorScheme }],
      });
    } else {
      warnings.push('colorScheme is not supported on Firefox');
    }
  }

  if (state.timezone) {
    if (chromium) {
      await cdpSend(driver, 'Emulation.setTimezoneOverride', { timezoneId: state.timezone });
    } else {
      warnings.push('timezone is not supported on Firefox');
    }
  }

  if (state.geolocation) {
    if (chromium) {
      await cdpSend(driver, 'Emulation.setGeolocationOverride', {
        latitude: state.geolocation.latitude,
        longitude: state.geolocation.longitude,
        accuracy: state.geolocation.accuracy ?? 1,
      });
    } else {
      warnings.push('geolocation is not supported on Firefox');
    }
  }

  if (state.permissions && state.permissions.length > 0) {
    if (chromium) {
      await applyPermissions(driver);
    } else {
      warnings.push('permissions is not supported on Firefox');
    }
  }

  // Runtime network/CPU emulation (`emulate` command, v0.8).
  // `offline !== undefined` (not just truthy) so an explicit `--offline=false`
  // sends the restore command instead of silently keeping the browser offline.
  if (state.offline !== undefined || state.throttleNetwork) {
    if (chromium) {
      const t = state.throttleNetwork || {};
      await cdpSend(driver, 'Network.emulateNetworkConditions', {
        offline: !!state.offline,
        latency: t.latency ?? 0,
        // CDP uses bytes/second; we accept kbps on the CLI.
        downloadThroughput: state.offline ? 0 : (t.download !== undefined ? t.download * 1000 : -1),
        uploadThroughput: state.offline ? 0 : (t.upload !== undefined ? t.upload * 1000 : -1),
      });
    } else {
      warnings.push('network emulation is not supported on Firefox');
    }
  }

  if (state.throttleCpu) {
    if (chromium) {
      await cdpSend(driver, 'Emulation.setCPUThrottlingRate', { rate: state.throttleCpu });
    } else {
      warnings.push('CPU throttling is not supported on Firefox');
    }
  }

  return warnings;
}

async function applyPermissions(driver: any): Promise<void> {
  // Browser.setPermission needs an origin. Prefer the current page origin;
  // before the first navigation the page is about:blank, so fall back to a
  // wildcard so the permission applies to any page opened later.
  let currentUrl = '';
  let origin = '*';
  try {
    currentUrl = await driver.getCurrentUrl();
    origin = new URL(currentUrl).origin;
    if (origin === 'null') origin = '*'; // opaque origin (about:blank)
  } catch {
    origin = '*';
  }
  for (const permission of state.permissions!) {
    try {
      await cdpSend(driver, 'Browser.setPermission', {
        origin,
        permission: { name: permission },
        setting: 'granted',
      });
    } catch {
      // The wildcard or an about:blank origin may be rejected — retry with
      // the literal URL before giving up on this permission.
      await cdpSend(driver, 'Browser.setPermission', {
        origin: currentUrl,
        permission: { name: permission },
        setting: 'granted',
      });
    }
  }
}

// ── Parsers for CLI flag values ────────────────────────────────────────

export function parseViewport(value: string): EmulationViewport {
  const m = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!m) throw new Error(`Invalid --viewport: "${value}". Expected WxH, e.g. 1280x720`);
  const width = parseInt(m[1], 10);
  const height = parseInt(m[2], 10);
  if (width <= 0 || height <= 0) throw new Error(`Invalid --viewport: "${value}". Width and height must be positive`);
  return { width, height };
}

export function parseGeolocation(value: string): EmulationGeolocation {
  const parts = value.split(',');
  const latitude = parseFloat(parts[0]);
  const longitude = parseFloat(parts[1]);
  if (parts.length < 2 || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Invalid --geolocation: "${value}". Expected lat,lon[,accuracy]`);
  }
  let accuracy: number | undefined;
  if (parts.length >= 3) {
    const a = parseFloat(parts[2]);
    if (!Number.isFinite(a)) throw new Error(`Invalid --geolocation: "${value}". Accuracy must be a number`);
    accuracy = a;
  }
  return { latitude, longitude, accuracy };
}

export function parseThrottleNetwork(value: string): EmulationThrottleNetwork {
  const v = value.trim();
  if (v === 'slow3g') return { download: 400, upload: 400, latency: 400 };
  if (v === 'fast3g') return { download: 1500, upload: 750, latency: 100 };
  if (v === 'gprs') return { download: 50, upload: 20, latency: 500 };
  const m = /^custom:(.*)$/.exec(v);
  if (m) {
    const t: EmulationThrottleNetwork = {};
    for (const part of m[1].split(',')) {
      if (!part) continue;
      const [k, val] = part.split('=');
      const num = parseFloat(val);
      if (!Number.isFinite(num)) throw new Error(`Invalid custom throttle value: "${part}"`);
      if (k === 'download') t.download = num;
      else if (k === 'upload') t.upload = num;
      else if (k === 'latency') t.latency = num;
      else throw new Error(`Unknown custom throttle key: "${k}" (expected download, upload, latency)`);
    }
    return t;
  }
  throw new Error(`Invalid --throttle-network: "${value}". Expected slow3g, fast3g, gprs, or custom:download=,upload=,latency=`);
}

export function describeEmulation(stateToDescribe: EmulationState = state): string {
  const parts: string[] = [];
  if (stateToDescribe.viewport) {
    parts.push(`viewport ${stateToDescribe.viewport.width}x${stateToDescribe.viewport.height}${stateToDescribe.viewport.deviceScaleFactor && stateToDescribe.viewport.deviceScaleFactor !== 1 ? `@${stateToDescribe.viewport.deviceScaleFactor}x` : ''}`);
  }
  if (stateToDescribe.userAgent) parts.push('userAgent');
  if (stateToDescribe.locale) parts.push(`locale=${stateToDescribe.locale}`);
  if (stateToDescribe.colorScheme) parts.push(`colorScheme=${stateToDescribe.colorScheme}`);
  if (stateToDescribe.timezone) parts.push(`timezone=${stateToDescribe.timezone}`);
  if (stateToDescribe.geolocation) {
    parts.push(`geolocation=${stateToDescribe.geolocation.latitude},${stateToDescribe.geolocation.longitude}`);
  }
  if (stateToDescribe.permissions && stateToDescribe.permissions.length > 0) {
    parts.push(`permissions=${stateToDescribe.permissions.join(',')}`);
  }
  if (stateToDescribe.offline) parts.push('offline');
  if (stateToDescribe.throttleNetwork) {
    const t = stateToDescribe.throttleNetwork;
    const bits: string[] = [];
    if (t.download !== undefined) bits.push(`down=${t.download}kbps`);
    if (t.upload !== undefined) bits.push(`up=${t.upload}kbps`);
    if (t.latency !== undefined) bits.push(`latency=${t.latency}ms`);
    parts.push(`throttle(${bits.join(',')})`);
  }
  if (stateToDescribe.throttleCpu) parts.push(`cpu=${stateToDescribe.throttleCpu}x`);
  return parts.length > 0 ? parts.join(' ') : '(no emulation active)';
}
