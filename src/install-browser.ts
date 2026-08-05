import { detectBrowser, type BrowserName } from './detect-browser';
import { binaryPaths } from 'selenium-webdriver/common/seleniumManager';

/**
 * Browser driver installation via Selenium Manager.
 *
 * spec §6.1/§9: on driver startup failure the CLI suggests
 * `se-cli install-browser` so users can explicitly install/verify the
 * driver (and browser) for a target browser — useful for CI setups and
 * offline machines where the first `open` would otherwise trigger a
 * driver download.
 */

export interface InstallBrowserResult {
  browserName: string;
  driverPath: string;
  browserPath: string | null;
}

const VALID_BROWSERS: BrowserName[] = ['chrome', 'edge', 'firefox'];

export function resolveBrowserName(name?: string): BrowserName {
  if (name) {
    const normalized = name.toLowerCase() as BrowserName;
    if (!VALID_BROWSERS.includes(normalized)) {
      throw new Error(
        `Unsupported browser: ${name}. Supported: ${VALID_BROWSERS.join(', ')}`
      );
    }
    return normalized;
  }
  const detected = detectBrowser();
  if (!detected) {
    throw new Error('No browser detected. Specify a browser: chrome, edge, or firefox.');
  }
  return detected;
}

/**
 * Run Selenium Manager for the given browser to install/verify the
 * driver (and resolve the browser path). Throws on failure.
 */
export async function installBrowser(browserName: BrowserName): Promise<InstallBrowserResult> {
  const result = binaryPaths(['--browser', browserName, '--output', 'json']);
  return {
    browserName,
    driverPath: result.driverPath || '',
    browserPath: result.browserPath || null,
  };
}
