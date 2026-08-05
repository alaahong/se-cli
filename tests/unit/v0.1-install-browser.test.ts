/**
 * Unit tests for src/install-browser.ts — the `se-cli install-browser`
 * command (spec §6.1/§9: suggested on driver startup failure).
 *
 * Selenium Manager is mocked; the tests cover browser-name resolution,
 * validation, and the install result mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveBrowserName, installBrowser } from '../../src/install-browser';
import { detectBrowser } from '../../src/detect-browser';

vi.mock('../../src/detect-browser', () => ({
  detectBrowser: vi.fn(),
}));

const binaryPathsMock = vi.hoisted(() => vi.fn());
vi.mock('selenium-webdriver/common/seleniumManager', () => ({
  binaryPaths: binaryPathsMock,
}));

describe('resolveBrowserName', () => {
  it('accepts a valid explicit browser name (case-insensitive)', () => {
    expect(resolveBrowserName('Chrome')).toBe('chrome');
    expect(resolveBrowserName('edge')).toBe('edge');
    expect(resolveBrowserName('FIREFOX')).toBe('firefox');
  });

  it('rejects an unsupported browser name', () => {
    expect(() => resolveBrowserName('safari')).toThrow(/Unsupported browser/);
    expect(() => resolveBrowserName('ie')).toThrow(/chrome, edge, firefox/);
  });

  it('falls back to auto-detection when no name is given', () => {
    (detectBrowser as any).mockReturnValue('chrome');
    expect(resolveBrowserName()).toBe('chrome');
  });

  it('throws when no browser is given and none can be detected', () => {
    (detectBrowser as any).mockReturnValue(null);
    expect(() => resolveBrowserName()).toThrow(/No browser detected/);
  });
});

describe('installBrowser', () => {
  afterEach(() => {
    binaryPathsMock.mockReset();
  });

  it('maps Selenium Manager binary paths to an InstallBrowserResult', async () => {
    binaryPathsMock.mockReturnValue({
      driverPath: '/drivers/chromedriver',
      browserPath: '/browsers/chrome',
    });
    const result = await installBrowser('chrome');
    expect(result).toEqual({
      browserName: 'chrome',
      driverPath: '/drivers/chromedriver',
      browserPath: '/browsers/chrome',
    });
  });

  it('passes the selenium-manager args for the requested browser', async () => {
    binaryPathsMock.mockReturnValue({ driverPath: '/d', browserPath: null });
    await installBrowser('firefox');
    expect(binaryPathsMock).toHaveBeenCalledWith(
      expect.arrayContaining(['--browser', 'firefox']),
    );
  });

  it('returns browserPath null when Selenium Manager reports none', async () => {
    binaryPathsMock.mockReturnValue({ driverPath: '/d', browserPath: '' });
    const result = await installBrowser('edge');
    expect(result.browserPath).toBeNull();
    expect(result.driverPath).toBe('/d');
  });

  it('propagates Selenium Manager failures', async () => {
    binaryPathsMock.mockImplementation(() => {
      throw new Error('driver not found');
    });
    await expect(installBrowser('chrome')).rejects.toThrow(/driver not found/);
  });
});
