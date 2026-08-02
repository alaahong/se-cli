import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Response } from '../../src/response';
import { DEVICE_PRESETS, findDevice } from '../../src/devices';
import { browser_device, browser_device_list } from '../../src/daemon/tools/device';
import { setEmulationState, getEmulationState } from '../../src/daemon/tools/emulation-state';

function makeDriver() {
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
    getCurrentUrl: vi.fn(async () => 'https://example.com/'),
  };
  return { driver, sent };
}

describe('devices data', () => {
  it('contains curated presets with required fields', () => {
    expect(DEVICE_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of DEVICE_PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.userAgent).toContain('Mozilla');
      expect(p.viewport.width).toBeGreaterThan(0);
      expect(p.viewport.height).toBeGreaterThan(0);
      expect(p.deviceScaleFactor).toBeGreaterThanOrEqual(1);
    }
  });

  it('finds devices case-insensitively', () => {
    expect(findDevice('iPhone 13')?.name).toBe('iPhone 13');
    expect(findDevice('iphone 13')?.name).toBe('iPhone 13');
    expect(findDevice('IPHONE 15 PRO')?.name).toBe('iPhone 15 Pro');
    expect(findDevice('nope')).toBeUndefined();
  });

  it('includes well-known presets', () => {
    expect(findDevice('iPhone 13')).toBeDefined();
    expect(findDevice('Pixel 7')).toBeDefined();
    expect(findDevice('Galaxy S23')).toBeDefined();
    expect(findDevice('Desktop Chrome')).toBeDefined();
  });
});

describe('browser_device', () => {
  beforeEach(() => {
    setEmulationState({});
  });

  it('applies a preset via CDP metrics + UA override', async () => {
    const { driver, sent } = makeDriver();
    const response = new Response({ raw: false, json: false });
    await browser_device(driver, { name: 'iPhone 13' }, response);
    const text = response.serialize();
    expect(text).toContain('device "iPhone 13" applied');
    expect(text).toContain('390x664@3x');
    // CDP viewport override with mobile/touch
    const metrics = sent.find(([m]) => m === 'Emulation.setDeviceMetricsOverride');
    expect(metrics).toBeDefined();
    expect(metrics![1]).toMatchObject({ width: 390, height: 664, deviceScaleFactor: 3, mobile: true, hasTouch: true });
    const ua = sent.find(([m]) => m === 'Network.setUserAgentOverride');
    expect(ua![1].userAgent).toContain('iPhone');
    // State persisted for driver rebuild replay
    expect(getEmulationState().viewport).toMatchObject({ width: 390, height: 664 });
    expect(getEmulationState().userAgent).toContain('iPhone');
  });

  it('reports an error for an unknown device', async () => {
    const { driver } = makeDriver();
    const response = new Response({ raw: false, json: false });
    await browser_device(driver, { name: 'Commodore 64' }, response);
    const text = response.serialize();
    expect(text).toContain('Unknown device');
    expect(text).toContain('device-list');
  });

  it('shows current emulation state when no name is given', async () => {
    const { driver } = makeDriver();
    setEmulationState({ locale: 'de-DE' });
    const response = new Response({ raw: false, json: false });
    await browser_device(driver, {}, response);
    expect(response.serialize()).toContain('locale=de-DE');
  });

  it('keeps unrelated emulation state when applying a preset', async () => {
    const { driver } = makeDriver();
    setEmulationState({ timezone: 'Asia/Shanghai' });
    const response = new Response({ raw: false, json: false });
    await browser_device(driver, { name: 'Pixel 7' }, response);
    expect(getEmulationState().timezone).toBe('Asia/Shanghai');
    expect(getEmulationState().viewport).toMatchObject({ width: 412, height: 915 });
  });
});

describe('browser_device_list', () => {
  it('lists all presets with viewport info', async () => {
    const response = new Response({ raw: false, json: false });
    await browser_device_list(null as any, {}, response);
    const text = response.serialize();
    expect(text).toContain('iPhone 13');
    expect(text).toContain('Pixel 7');
    expect(text).toContain('390x664@3x');
    expect(text).toContain('mobile=yes');
  });
});
