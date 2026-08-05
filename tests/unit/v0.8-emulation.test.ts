import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setEmulationState,
  getEmulationState,
  resetEmulationState,
  applyEmulation,
  parseViewport,
  parseGeolocation,
  parseThrottleNetwork,
  updateEmulationState,
  describeEmulation,
} from '../../src/daemon/tools/emulation-state';
import { browser_emulate } from '../../src/daemon/tools/emulate';
import { Response } from '../../src/response';

function makeChromiumDriver() {
  const sent: Array<[string, any]> = [];
  const cdp = {
    send: vi.fn(async (method: string, params: any) => {
      sent.push([method, params]);
      return { result: {} };
    }),
  };
  const driver = {
    createCDPConnection: vi.fn(async () => cdp),
    getCapabilities: vi.fn(async () => ({ get: (k: string) => (k === 'browserName' ? 'chrome' : undefined) })),
    getCurrentUrl: vi.fn(async () => 'https://example.com/page'),
  };
  return { driver, cdp, sent };
}

function makeFirefoxDriver() {
  const bidi = { send: vi.fn(async () => ({ result: {} })) };
  const driver = {
    getCapabilities: vi.fn(async () => ({ get: (k: string) => (k === 'browserName' ? 'firefox' : undefined) })),
    getBidi: vi.fn(async () => bidi),
    getWindowHandle: vi.fn(async () => 'ctx-1'),
    createCDPConnection: vi.fn(async () => {
      throw new Error('CDP support for Firefox is removed');
    }),
  };
  return { driver, bidi };
}

describe('emulation-state parsers', () => {
  it('parses viewport WxH', () => {
    expect(parseViewport('1280x720')).toEqual({ width: 1280, height: 720 });
    expect(parseViewport('390x844')).toEqual({ width: 390, height: 844 });
  });

  it('rejects invalid viewport values', () => {
    expect(() => parseViewport('abc')).toThrow(/Invalid --viewport/);
    expect(() => parseViewport('0x100')).toThrow(/Invalid --viewport/);
    expect(() => parseViewport('100')).toThrow(/Invalid --viewport/);
  });

  it('parses geolocation lat,lon and lat,lon,accuracy', () => {
    expect(parseGeolocation('40.7,-74.0')).toEqual({ latitude: 40.7, longitude: -74 });
    expect(parseGeolocation('40.7,-74.0,5')).toEqual({ latitude: 40.7, longitude: -74, accuracy: 5 });
  });

  it('rejects invalid geolocation values', () => {
    expect(() => parseGeolocation('abc')).toThrow(/Invalid --geolocation/);
    expect(() => parseGeolocation('1')).toThrow(/Invalid --geolocation/);
    expect(() => parseGeolocation('1,2,abc')).toThrow(/Invalid --geolocation/);
  });
});

describe('emulation-state describeEmulation', () => {
  beforeEach(() => {
    setEmulationState({});
  });

  it('returns a placeholder when nothing is active', () => {
    expect(describeEmulation()).toContain('no emulation active');
  });

  it('describes active capabilities', () => {
    setEmulationState({
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      locale: 'zh-CN',
      colorScheme: 'dark',
      timezone: 'Asia/Shanghai',
      geolocation: { latitude: 40.7, longitude: -74 },
      permissions: ['geolocation', 'camera'],
      userAgent: 'test-ua',
    });
    const desc = describeEmulation();
    expect(desc).toContain('viewport 390x844@3x');
    expect(desc).toContain('locale=zh-CN');
    expect(desc).toContain('colorScheme=dark');
    expect(desc).toContain('timezone=Asia/Shanghai');
    expect(desc).toContain('geolocation=40.7,-74');
    expect(desc).toContain('permissions=geolocation,camera');
    expect(desc).toContain('userAgent');
  });
});

describe('emulation-state applyEmulation', () => {
  beforeEach(() => {
    setEmulationState({});
    resetEmulationState();
  });

  it('applies viewport via CDP on Chrome', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ viewport: { width: 1280, height: 720 } });
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([]);
    expect(sent).toEqual([
      ['Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, hasTouch: false,
        screenWidth: 1280, screenHeight: 720,
      }],
    ]);
  });

  it('applies device-metric viewport (scale/mobile/touch) via CDP', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, hasTouch: true } });
    await applyEmulation(driver);
    expect(sent[0]).toEqual([
      'Emulation.setDeviceMetricsOverride',
      expect.objectContaining({ deviceScaleFactor: 3, mobile: true, hasTouch: true }),
    ]);
  });

  it('applies UA, locale, color scheme, timezone and geolocation via CDP', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({
      userAgent: 'se-test-ua',
      locale: 'zh-CN',
      colorScheme: 'dark',
      timezone: 'Asia/Shanghai',
      geolocation: { latitude: 40.7, longitude: -74, accuracy: 2 },
    });
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([]);
    expect(sent).toContainEqual(['Network.setUserAgentOverride', { userAgent: 'se-test-ua' }]);
    expect(sent).toContainEqual(['Emulation.setLocaleOverride', { locale: 'zh-CN' }]);
    expect(sent).toContainEqual(['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }]);
    expect(sent).toContainEqual(['Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' }]);
    expect(sent).toContainEqual(['Emulation.setGeolocationOverride', { latitude: 40.7, longitude: -74, accuracy: 2 }]);
  });

  it('grants permissions via Browser.setPermission with the page origin', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ permissions: ['geolocation', 'camera'] });
    await applyEmulation(driver);
    expect(sent).toContainEqual(['Browser.setPermission', {
      origin: 'https://example.com',
      permission: { name: 'geolocation' },
      setting: 'granted',
    }]);
    expect(sent).toContainEqual(['Browser.setPermission', {
      origin: 'https://example.com',
      permission: { name: 'camera' },
      setting: 'granted',
    }]);
  });

  it('falls back to wildcard origin when the current URL is not parseable', async () => {
    const driver = makeChromiumDriver().driver;
    driver.getCurrentUrl = vi.fn(async () => 'about:blank');
    const sent: Array<[string, any]> = [];
    const cdp = {
      send: vi.fn(async (method: string, params: any) => {
        sent.push([method, params]);
        return { result: {} };
      }),
    };
    driver.createCDPConnection = vi.fn(async () => cdp);
    setEmulationState({ permissions: ['geolocation'] });
    await applyEmulation(driver);
    expect(sent[0][1].origin).toBe('*');
  });

  it('applies viewport via BiDi on Firefox and warns about CDP-only capabilities', async () => {
    const { driver, bidi } = makeFirefoxDriver();
    setEmulationState({
      viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
      userAgent: 'ff-ua',
      timezone: 'UTC',
    });
    const warnings = await applyEmulation(driver);
    expect(bidi.send).toHaveBeenCalledWith({
      method: 'browsingContext.setViewport',
      params: {
        context: 'ctx-1',
        viewport: { width: 1280, height: 720 },
        devicePixelRatio: 2,
      },
    });
    expect(warnings).toEqual([
      'userAgent is not supported on Firefox',
      'timezone is not supported on Firefox',
    ]);
  });

  it('does nothing when no emulation state is set', async () => {
    const { driver, cdp } = makeChromiumDriver();
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([]);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it('caches the CDP connection across apply calls', async () => {
    const { driver } = makeChromiumDriver();
    setEmulationState({ userAgent: 'ua' });
    await applyEmulation(driver);
    await applyEmulation(driver);
    expect(driver.createCDPConnection).toHaveBeenCalledTimes(1);
  });

  it('recreates the CDP connection after resetEmulationState', async () => {
    const { driver } = makeChromiumDriver();
    setEmulationState({ userAgent: 'ua' });
    await applyEmulation(driver);
    resetEmulationState();
    await applyEmulation(driver);
    expect(driver.createCDPConnection).toHaveBeenCalledTimes(2);
  });

  it('throws when a CDP command returns an error payload', async () => {
    const { driver } = makeChromiumDriver();
    const cdp = { send: vi.fn(async () => ({ error: { message: 'boom' } })) };
    driver.createCDPConnection = vi.fn(async () => cdp);
    setEmulationState({ timezone: 'Invalid/Zone' });
    await expect(applyEmulation(driver)).rejects.toThrow('Emulation.setTimezoneOverride: boom');
  });

  it('returns the emulation state for state-save integration', () => {
    setEmulationState({ locale: 'fr-FR' });
    expect(getEmulationState()).toEqual({ locale: 'fr-FR' });
  });

  it('replaces stale keys when setting state (delete branch)', () => {
    setEmulationState({ viewport: { width: 100, height: 200 }, locale: 'en-US' });
    setEmulationState({ timezone: 'UTC' });
    expect(getEmulationState()).toEqual({ timezone: 'UTC' });
  });

  it('warns for every CDP-only capability on Firefox', async () => {
    const { driver } = makeFirefoxDriver();
    setEmulationState({
      locale: 'fr-FR',
      colorScheme: 'dark',
      geolocation: { latitude: 1, longitude: 2 },
      permissions: ['geolocation'],
    });
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([
      'locale is not supported on Firefox',
      'colorScheme is not supported on Firefox',
      'geolocation is not supported on Firefox',
      'permissions is not supported on Firefox',
    ]);
  });

  it('throws when Firefox BiDi setViewport returns an error', async () => {
    const { driver } = makeFirefoxDriver();
    driver.getBidi = vi.fn(async () => ({
      send: vi.fn(async () => ({ error: { message: 'no such frame' } })),
    }));
    setEmulationState({ viewport: { width: 800, height: 600 } });
    await expect(applyEmulation(driver)).rejects.toThrow('browsingContext.setViewport');
  });

  it('falls back to the literal URL when wildcard permission fails', async () => {
    const driver = makeChromiumDriver().driver;
    driver.getCurrentUrl = vi.fn(async () => 'about:blank');
    const sent: Array<[string, any]> = [];
    let fails = true;
    const cdp = {
      send: vi.fn(async (method: string, params: any) => {
        sent.push([method, params]);
        if (fails) {
          fails = false;
          throw new Error('origin rejected');
        }
        return { result: {} };
      }),
    };
    driver.createCDPConnection = vi.fn(async () => cdp);
    setEmulationState({ permissions: ['geolocation'] });
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([]);
    expect(sent[0][1].origin).toBe('*');
    expect(sent[1][1].origin).toBe('about:blank');
    expect(sent).toHaveLength(2);
  });

  it('propagates the error when both permission origins fail', async () => {
    const driver = makeChromiumDriver().driver;
    driver.getCurrentUrl = vi.fn(async () => 'https://a.example/x');
    driver.createCDPConnection = vi.fn(async () => ({
      send: vi.fn(async () => {
        throw new Error('no permission origin');
      }),
    }));
    setEmulationState({ permissions: ['geolocation'] });
    await expect(applyEmulation(driver)).rejects.toThrow('no permission origin');
  });

  it('falls back to wildcard when getCurrentUrl throws', async () => {
    const driver = makeChromiumDriver().driver;
    driver.getCurrentUrl = vi.fn(async () => {
      throw new Error('session dead');
    });
    const sent: Array<[string, any]> = [];
    driver.createCDPConnection = vi.fn(async () => ({
      send: vi.fn(async (method: string, params: any) => {
        sent.push([method, params]);
        return { result: {} };
      }),
    }));
    setEmulationState({ permissions: ['camera'] });
    await applyEmulation(driver);
    expect(sent[0][1].origin).toBe('*');
  });
});

describe('emulation-state network/CPU (emulate)', () => {
  beforeEach(() => {
    setEmulationState({});
    resetEmulationState();
  });

  it('parses throttle presets', () => {
    expect(parseThrottleNetwork('slow3g')).toEqual({ download: 400, upload: 400, latency: 400 });
    expect(parseThrottleNetwork('fast3g')).toEqual({ download: 1500, upload: 750, latency: 100 });
    expect(parseThrottleNetwork('gprs')).toEqual({ download: 50, upload: 20, latency: 500 });
  });

  it('parses custom throttle with download/upload/latency', () => {
    expect(parseThrottleNetwork('custom:download=100,upload=50,latency=200'))
      .toEqual({ download: 100, upload: 50, latency: 200 });
  });

  it('rejects invalid throttle values', () => {
    expect(() => parseThrottleNetwork('bogus')).toThrow(/Invalid --throttle-network/);
    expect(() => parseThrottleNetwork('custom:download=abc')).toThrow(/Invalid custom throttle/);
    expect(() => parseThrottleNetwork('custom:foo=1')).toThrow(/Unknown custom throttle key/);
  });

  it('applies offline + network throttle via CDP (kbps -> bytes/s)', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ offline: true, throttleNetwork: { download: 400, upload: 400, latency: 400 } });
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([]);
    expect(sent).toContainEqual(['Network.emulateNetworkConditions', {
      offline: true, latency: 400, downloadThroughput: 0, uploadThroughput: 0,
    }]);
  });

  it('applies throttle without offline via CDP', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ throttleNetwork: { download: 100, upload: 50, latency: 200 } });
    await applyEmulation(driver);
    expect(sent).toContainEqual(['Network.emulateNetworkConditions', {
      offline: false, latency: 200, downloadThroughput: 100000, uploadThroughput: 50000,
    }]);
  });

  it('applies CPU throttling via CDP', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ throttleCpu: 4 });
    await applyEmulation(driver);
    expect(sent).toContainEqual(['Emulation.setCPUThrottlingRate', { rate: 4 }]);
  });

  it('warns on Firefox for network/CPU emulation', async () => {
    const { driver } = makeFirefoxDriver();
    setEmulationState({ offline: true, throttleCpu: 4 });
    const warnings = await applyEmulation(driver);
    expect(warnings).toEqual([
      'network emulation is not supported on Firefox',
      'CPU throttling is not supported on Firefox',
    ]);
  });

  it('describes runtime state', () => {
    setEmulationState({ offline: true, throttleNetwork: { download: 400, latency: 400 }, throttleCpu: 2 });
    const desc = describeEmulation();
    expect(desc).toContain('offline');
    expect(desc).toContain('down=400kbps');
    expect(desc).toContain('latency=400ms');
    expect(desc).toContain('cpu=2x');
  });
});

describe('browser_emulate', () => {
  beforeEach(() => {
    setEmulationState({});
    resetEmulationState();
  });

  it('shows current state when no flags given', async () => {
    const { driver } = makeChromiumDriver();
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, {}, response);
    expect(response.serialize()).toContain('no emulation active');
  });

  it('applies offline flag', async () => {
    const { driver, sent } = makeChromiumDriver();
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, { offline: true }, response);
    expect(response.serialize()).toContain('emulation applied');
    expect(response.serialize()).toContain('offline');
    expect(sent).toContainEqual(['Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    }]);
  });

  it('applies custom network throttle', async () => {
    const { driver } = makeChromiumDriver();
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, { throttleNetwork: 'custom:download=100,upload=50,latency=200' }, response);
    const text = response.serialize();
    expect(text).toContain('down=100kbps');
    expect(text).toContain('up=50kbps');
    expect(text).toContain('latency=200ms');
  });

  it('applies CPU throttle', async () => {
    const { driver, sent } = makeChromiumDriver();
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, { throttleCpu: '4' }, response);
    expect(response.serialize()).toContain('cpu=4x');
    expect(sent).toContainEqual(['Emulation.setCPUThrottlingRate', { rate: 4 }]);
  });

  it('rejects an invalid CPU throttle', async () => {
    const { driver } = makeChromiumDriver();
    const response = new Response({ raw: false, json: false });
    await expect(browser_emulate(driver, { throttleCpu: '0' }, response)).rejects.toThrow(/Invalid --throttle-cpu/);
  });

  it('resets only runtime state, keeping open flags', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ locale: 'zh-CN', offline: true, throttleNetwork: { download: 400, upload: 400, latency: 400 }, throttleCpu: 4 });
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, { reset: true }, response);
    const state = getEmulationState();
    expect(state.locale).toBe('zh-CN'); // open-time flag preserved
    expect(state.offline).toBeUndefined();
    expect(state.throttleNetwork).toBeNull();
    expect(state.throttleCpu).toBeNull();
    expect(response.serialize()).toContain('emulation reset');
    expect(response.serialize()).toContain('locale=zh-CN');
    // Reset MUST restore the browser to the online, unthrottled state —
    // otherwise the browser stays offline / CPU-throttled forever.
    expect(sent).toContainEqual(['Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }]);
    expect(sent).toContainEqual(['Emulation.setCPUThrottlingRate', { rate: 1 }]);
  });

  it('sends restore commands on reset even when only one runtime flag was set', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ throttleCpu: 2 });
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, { reset: true }, response);
    expect(sent).toContainEqual(['Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }]);
    expect(sent).toContainEqual(['Emulation.setCPUThrottlingRate', { rate: 1 }]);
  });

  it('throws on Firefox', async () => {
    const { driver } = makeFirefoxDriver();
    const response = new Response({ raw: false, json: false });
    await expect(browser_emulate(driver, { offline: true }, response)).rejects.toThrow('not supported on Firefox');
  });

  it('restores online with explicit offline=false after being offline', async () => {
    const { driver, sent } = makeChromiumDriver();
    setEmulationState({ offline: true });
    const response = new Response({ raw: false, json: false });
    await browser_emulate(driver, { offline: false }, response);
    const state = getEmulationState();
    expect(state.offline).toBe(false);
    expect(response.serialize()).toContain('emulation applied');
    // The restore command must be sent — the browser would otherwise stay offline.
    expect(sent).toContainEqual(['Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }]);
  });
});
