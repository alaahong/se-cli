import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Response } from '../../src/response';
import { browser_state_save, browser_state_load } from '../../src/daemon/tools/state';
import { setEmulationState, getEmulationState, resetEmulationState } from '../../src/daemon/tools/emulation-state';

function makeChromiumDriver() {
  const sent: Array<[string, any]> = [];
  const cdp = {
    send: vi.fn(async (method: string, params: any) => {
      sent.push([method, params]);
      return { result: {} };
    }),
  };
  const driver = {
    manage: vi.fn(() => ({
      getCookies: vi.fn(async () => []),
      deleteAllCookies: vi.fn(async () => {}),
      addCookie: vi.fn(async () => {}),
    })),
    executeScript: vi.fn(async () => ({})),
    getCurrentUrl: vi.fn(async () => 'https://example.com'),
    get: vi.fn(async () => {}),
    createCDPConnection: vi.fn(async () => cdp),
    getCapabilities: vi.fn(async () => ({ get: (k: string) => (k === 'browserName' ? 'chrome' : undefined) })),
  };
  return { driver, sent };
}

describe('state-save/load emulation integration (v0.8)', () => {
  let tmpDir: string;
  let cwdSpy: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-state-emu-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    setEmulationState({});
    resetEmulationState();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('includes emulation state in state-save when active', async () => {
    setEmulationState({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, offline: true });
    const { driver } = makeChromiumDriver();
    const resp = new Response({ raw: false, json: true });
    await browser_state_save(driver, { filename: 'emu-state.json' }, resp);

    const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.se-cli', 'emu-state.json'), 'utf8'));
    expect(state.emulation).toEqual({
      locale: 'zh-CN',
      viewport: { width: 390, height: 844 },
      offline: true,
    });
    expect(resp.serialize()).toContain('emulation:');
  });

  it('omits emulation field in state-save when nothing is active', async () => {
    const { driver } = makeChromiumDriver();
    const resp = new Response({ raw: false, json: true });
    await browser_state_save(driver, { filename: 'plain-state.json' }, resp);

    const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.se-cli', 'plain-state.json'), 'utf8'));
    expect(state.emulation).toBeUndefined();
  });

  it('restores emulation state on state-load via CDP', async () => {
    const { driver, sent } = makeChromiumDriver();
    fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.se-cli', 'with-emu.json'), JSON.stringify({
      url: 'https://example.com',
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      emulation: { timezone: 'Asia/Shanghai', locale: 'fr-FR', throttleCpu: 2 },
      savedAt: new Date().toISOString(),
    }));

    const resp = new Response({ raw: false, json: true });
    await browser_state_load(driver, { filename: 'with-emu.json' }, resp);

    expect(getEmulationState().timezone).toBe('Asia/Shanghai');
    expect(getEmulationState().locale).toBe('fr-FR');
    expect(getEmulationState().throttleCpu).toBe(2);
    expect(sent).toContainEqual(['Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' }]);
    expect(sent).toContainEqual(['Emulation.setLocaleOverride', { locale: 'fr-FR' }]);
    expect(resp.serialize()).toContain('emulation:');
    expect(resp.serialize()).toContain('timezone=Asia/Shanghai');
  });

  it('does not restore emulation when state file has none', async () => {
    const { driver, sent } = makeChromiumDriver();
    fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.se-cli', 'no-emu.json'), JSON.stringify({
      url: 'https://example.com',
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      savedAt: new Date().toISOString(),
    }));

    const resp = new Response({ raw: false, json: true });
    await browser_state_load(driver, { filename: 'no-emu.json' }, resp);

    expect(getEmulationState()).toEqual({});
    expect(sent).toHaveLength(0);
    expect(resp.serialize()).not.toContain('emulation:');
  });

  it('ignores unknown emulation keys in hand-edited state files', async () => {
    const { driver, sent } = makeChromiumDriver();
    fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.se-cli', 'hand-edited.json'), JSON.stringify({
      url: 'https://example.com',
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      emulation: { hacky: 'value', locale: 'fr-FR', viewport: 'not-an-object' },
      savedAt: new Date().toISOString(),
    }));

    const resp = new Response({ raw: false, json: true });
    await browser_state_load(driver, { filename: 'hand-edited.json' }, resp);

    expect(getEmulationState()).toEqual({ locale: 'fr-FR' });
    expect(sent).toContainEqual(['Emulation.setLocaleOverride', { locale: 'fr-FR' }]);
  });
});
