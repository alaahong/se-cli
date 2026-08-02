/**
 * v0.8 Device presets — a curated subset of Playwright's DeviceDescriptors.
 * Each preset carries the UA + viewport + deviceScaleFactor + mobile/touch
 * flags needed to emulate that device via CDP Emulation.setDeviceMetricsOverride
 * (Chrome/Edge) or BiDi browsingContext.setViewport (Firefox, viewport only).
 */

export interface DevicePreset {
  name: string;
  userAgent: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  /** E.g. 'dark' forces prefers-color-scheme via CDP when set. */
  colorScheme?: 'light' | 'dark';
  /** E.g. 'portrait' — only used to pick the viewport if landscape not given. */
  orientation?: 'portrait' | 'landscape';
}

export const DEVICE_PRESETS: DevicePreset[] = [
  {
    name: 'Desktop Chrome',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  {
    name: 'iPhone 13',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 664 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'iPhone 14',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 664 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'iPhone 15',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 659 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'iPhone 15 Pro',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 659 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'iPad Pro 11',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 834, height: 1194 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Pixel 7',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Pixel 8',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Galaxy S23',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Galaxy S24',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
];

export function findDevice(name: string): DevicePreset | undefined {
  const normalized = name.trim().toLowerCase();
  return DEVICE_PRESETS.find(p => p.name.toLowerCase() === normalized);
}
