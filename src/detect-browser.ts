import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type BrowserName = 'edge' | 'chrome' | 'firefox';

// Probe order when no --browser flag is given: Edge → Chrome → Firefox.
export const BROWSER_PROBE_ORDER: BrowserName[] = ['edge', 'chrome', 'firefox'];

function programFiles(x86: boolean): string {
  const envKey = x86 ? 'ProgramFiles(x86)' : 'ProgramFiles';
  return process.env[envKey] || (x86 ? 'C:\\Program Files (x86)' : 'C:\\Program Files');
}

// Candidates discovered via PATH lookup (covers snap/flatpak on Linux,
// /usr/local/bin installs, homebrew, and any custom PATH entry).
function inPath(binNames: string[]): string[] {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter((d) => d);
  return dirs.flatMap((dir) => binNames.map((bin) => path.join(dir, bin)));
}

export function browserCandidates(browser: BrowserName, platform: NodeJS.Platform = process.platform): string[] {
  const home = os.homedir();
  if (platform === 'win32') {
    switch (browser) {
      case 'edge':
        return [
          // Per-user installs live under %LocalAppData% (e.g. Edge auto-update
          // on Windows without admin rights) — Chrome already covers this.
          path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFiles(true), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFiles(false), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ];
      case 'chrome':
        return [
          path.join(programFiles(false), 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFiles(true), 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ];
      case 'firefox':
        return [
          path.join(programFiles(false), 'Mozilla Firefox', 'firefox.exe'),
          path.join(programFiles(true), 'Mozilla Firefox', 'firefox.exe'),
        ];
    }
  } else if (platform === 'darwin') {
    switch (browser) {
      case 'edge':
        return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
      case 'chrome':
        return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
      case 'firefox':
        return ['/Applications/Firefox.app/Contents/MacOS/firefox'];
    }
  }
  // linux and everything else: common executable locations, snap/flatpak
  // installs (Ubuntu 22.04+ ships Firefox as a snap), and PATH lookup.
  switch (browser) {
    case 'edge':
      return [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/snap/bin/microsoft-edge',
        ...inPath(['microsoft-edge', 'microsoft-edge-stable']),
      ];
    case 'chrome':
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/google-chrome',
        ...inPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']),
      ];
    case 'firefox':
      return [
        '/usr/bin/firefox',
        '/usr/bin/firefox-esr',
        '/snap/bin/firefox',
        '/var/lib/flatpak/exports/bin/org.mozilla.firefox',
        ...inPath(['firefox', 'firefox-esr']),
      ];
  }
  return [];
}

/**
 * Detects the first installed browser in the order Edge → Chrome → Firefox.
 * @param check existence check, defaults to fs.existsSync (injectable for tests)
 * @param platform OS platform, defaults to process.platform (injectable for tests)
 * @returns the detected browser name, or null if none of the browsers is found
 */
export function detectBrowser(
  check: (p: string) => boolean = fs.existsSync,
  platform: NodeJS.Platform = process.platform,
): BrowserName | null {
  for (const name of BROWSER_PROBE_ORDER) {
    if (browserCandidates(name, platform).some(check)) return name;
  }
  return null;
}
