import { describe, it, expect } from 'vitest';
import { detectBrowser, browserCandidates, BROWSER_PROBE_ORDER } from '../../src/detect-browser';

function makeCheck(present: string[]): (p: string) => boolean {
  const set = new Set(present);
  return (p) => set.has(p);
}

describe('browserCandidates', () => {
  it('returns Edge candidates for win32/darwin/linux', () => {
    expect(browserCandidates('edge', 'win32').length).toBeGreaterThan(0);
    expect(browserCandidates('edge', 'win32')[0]).toContain('msedge.exe');
    expect(browserCandidates('edge', 'darwin')).toEqual(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
    expect(browserCandidates('edge', 'linux')).toContain('/usr/bin/microsoft-edge');
  });

  it('returns Chrome candidates for win32/darwin/linux', () => {
    expect(browserCandidates('chrome', 'win32').length).toBeGreaterThan(0);
    expect(browserCandidates('chrome', 'win32')[0]).toContain('chrome.exe');
    expect(browserCandidates('chrome', 'darwin')).toEqual(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
    expect(browserCandidates('chrome', 'linux')).toContain('/usr/bin/google-chrome');
    expect(browserCandidates('chrome', 'linux')).toContain('/usr/bin/chromium');
  });

  it('returns Firefox candidates for win32/darwin/linux', () => {
    expect(browserCandidates('firefox', 'win32').length).toBeGreaterThan(0);
    expect(browserCandidates('firefox', 'win32')[0]).toContain('firefox.exe');
    expect(browserCandidates('firefox', 'darwin')).toEqual(['/Applications/Firefox.app/Contents/MacOS/firefox']);
    expect(browserCandidates('firefox', 'linux')).toContain('/usr/bin/firefox');
  });
});

describe('detectBrowser', () => {
  it('probes in the order Edge → Chrome → Firefox', () => {
    expect(BROWSER_PROBE_ORDER).toEqual(['edge', 'chrome', 'firefox']);
  });

  it('returns edge when edge is installed', () => {
    const edge = browserCandidates('edge', 'win32')[0];
    expect(detectBrowser(makeCheck([edge]), 'win32')).toBe('edge');
  });

  it('falls back to chrome when edge is missing', () => {
    const chrome = browserCandidates('chrome', 'win32')[0];
    expect(detectBrowser(makeCheck([chrome]), 'win32')).toBe('chrome');
  });

  it('falls back to firefox when edge and chrome are missing', () => {
    const firefox = browserCandidates('firefox', 'linux')[0];
    expect(detectBrowser(makeCheck([firefox]), 'linux')).toBe('firefox');
  });

  it('returns null when no browser exists', () => {
    expect(detectBrowser(makeCheck([]), 'win32')).toBeNull();
    expect(detectBrowser(makeCheck([]), 'darwin')).toBeNull();
    expect(detectBrowser(makeCheck([]), 'linux')).toBeNull();
  });
});
