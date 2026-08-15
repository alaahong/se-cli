import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Response } from '../../src/response';
import { browser_goto } from '../../src/daemon/tools/goto';
import { browser_title } from '../../src/daemon/tools/title';
import { browser_click } from '../../src/daemon/tools/click';
import { browser_fill } from '../../src/daemon/tools/fill';
import { browser_snapshot } from '../../src/daemon/tools/snapshot';
import { browser_screenshot } from '../../src/daemon/tools/screenshot';
import { browser_eval } from '../../src/daemon/tools/eval';
import { resolveTarget, findElement, byToString, safeFilename } from '../../src/daemon/tools/shared';
import { By } from 'selenium-webdriver';
import { browser_cookie_list, browser_cookie_get, browser_cookie_set, browser_cookie_delete } from '../../src/daemon/tools/storage';
import { browser_localstorage_get, browser_localstorage_set, browser_localstorage_delete, browser_localstorage_list } from '../../src/daemon/tools/storage';
import { browser_sessionstorage_get, browser_sessionstorage_set, browser_sessionstorage_delete, browser_sessionstorage_list } from '../../src/daemon/tools/storage';
import { browser_tab_list, browser_tab_new, browser_tab_close, browser_tab_select } from '../../src/daemon/tools/tab';
import { browser_state_save, browser_state_load } from '../../src/daemon/tools/state';
import { browser_find } from '../../src/daemon/tools/find';
import { browser_check, browser_uncheck } from '../../src/daemon/tools/check';
import { browser_type } from '../../src/daemon/tools/type';
import { browser_press } from '../../src/daemon/tools/press';
import { browser_go_back, browser_go_forward, browser_reload } from '../../src/daemon/tools/navigation';
import { browser_url } from '../../src/daemon/tools/url';
import { ROLE_SCRIPT, CSS_INFO_SCRIPT, COUNT_ROLE_SCRIPT } from '../../src/daemon/tools/locator';
import { AssertionError } from '../../src/daemon/tools/expect';
import { parseCommand } from '../../src/daemon/backend';

function makeMockDriver(opts: any = {}): any {
  const calls: any[] = [];
  const driver = {
    get: vi.fn(async (url: string) => { calls.push({ method: 'get', url }); }),
    getTitle: vi.fn(async () => opts.title ?? 'Example Domain'),
    getCurrentUrl: vi.fn(async () => opts.url ?? 'https://example.com'),
    findElement: vi.fn(async (by: any) => ({
      click: vi.fn(async () => { calls.push({ method: 'click' }); }),
      clear: vi.fn(async () => { calls.push({ method: 'clear' }); }),
      sendKeys: vi.fn(async (...args: any[]) => { calls.push({ method: 'sendKeys', args }); }),
      takeScreenshot: vi.fn(async () => 'BASE64PNG'),
    })),
    executeScript: vi.fn(async (...args: any[]) => {
      calls.push({ method: 'executeScript', args });
      const script = args[0];
      // v0.9: locator heuristics dispatch — role extraction and CSS info
      // scripts must return structured data, everything else keeps the
      // snapshot YAML default. Scripts are wrapped as
      // `return (${ROLE_SCRIPT})(arguments[0]);` at the call site.
      if (typeof script === 'string' && script.includes(ROLE_SCRIPT)) return opts.roleName ?? { role: 'button', name: 'Save Draft' };
      if (typeof script === 'string' && script.includes(CSS_INFO_SCRIPT)) return opts.cssInfo ?? { id: '', classes: ['btn'], tag: 'button', nth: 1 };
      if (typeof script === 'string' && script.includes(COUNT_ROLE_SCRIPT)) return opts.roleMatchCount ?? 1;
      return opts.scriptResult ?? '- link:\n  - More information... [ref=e1]';
    }),
    findElements: vi.fn(async () => new Array(opts.matchCount ?? 1).fill({})),
    takeScreenshot: vi.fn(async () => 'BASE64PNG'),
    navigate: vi.fn(() => ({
      back: vi.fn(async () => {}),
      forward: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    })),
    switchTo: vi.fn(() => ({
      window: vi.fn(async (handle: string) => { calls.push({ method: 'switchTo.window', handle }); }),
      newWindow: vi.fn(async (type: string) => { calls.push({ method: 'newWindow', type }); }),
      frame: vi.fn(async (el: any) => { calls.push({ method: 'switchTo.frame', el }); }),
      defaultContent: vi.fn(async () => { calls.push({ method: 'switchTo.defaultContent' }); }),
    })),
    manage: vi.fn(() => ({
      getCookies: vi.fn(async () => opts.cookies ?? []),
      getCookie: vi.fn(async (name: string) => (opts.cookies ?? []).find((c: any) => c.name === name) ?? null),
      addCookie: vi.fn(async (cookie: any) => { calls.push({ method: 'addCookie', cookie }); }),
      deleteCookie: vi.fn(async (name: string) => { calls.push({ method: 'deleteCookie', name }); }),
      deleteAllCookies: vi.fn(async () => { calls.push({ method: 'deleteAllCookies' }); }),
    })),
    getAllWindowHandles: vi.fn(async () => opts.windowHandles ?? ['w1', 'w2']),
    getWindowHandle: vi.fn(async () => 'w1'),
    close: vi.fn(async () => { calls.push({ method: 'close' }); }),
    quit: vi.fn(async () => {}),
    _calls: calls,
  };
  return driver;
}

describe('shared.ts', () => {
  describe('resolveTarget', () => {
    it('resolves ref like e1 to data-se-ref selector', async () => {
      const by = await resolveTarget('e1');
      // selenium-webdriver By.css returns an object with using/value
      expect(by).toBeTruthy();
      // By.css may return a JS object or a function; check it was constructed
    });

    it('resolves CSS selector as By.css directly', async () => {
      const by = await resolveTarget('a.nav-link');
      expect(by).toBeTruthy();
    });

    it('e1 produces By.css with [data-se-ref="e1"]', async () => {
      // Inspect by calling By.css with the expected string and comparing
      const expected = By.css('[data-se-ref="e1"]');
      const actual = await resolveTarget('e1');
      // selenium-webdriver By objects can be compared via toString or values
      expect(String(actual)).toBe(String(expected));
    });

    it('plain selector produces By.css with that selector', async () => {
      const expected = By.css('a.nav-link');
      const actual = await resolveTarget('a.nav-link');
      expect(String(actual)).toBe(String(expected));
    });
  });

  describe('byToString', () => {
    it('ref returns By.css string with data-se-ref', () => {
      expect(byToString('e1')).toBe(`By.css('[data-se-ref="e1"]')`);
    });

    it('plain selector returns By.css string with that selector', () => {
      expect(byToString('a.nav-link')).toBe(`By.css('a.nav-link')`);
    });

    it('multi-digit ref works', () => {
      expect(byToString('e42')).toBe(`By.css('[data-se-ref="e42"]')`);
    });

    it('cross-frame ref produces frame comment and By.css', () => {
      const result = byToString('f0e1');
      expect(result).toContain('switchTo().frame(0)');
      expect(result).toContain(`By.css('[data-se-ref="e1"]')`);
    });

    it('cross-frame ref with multi-digit frame and ref', () => {
      const result = byToString('f3e15');
      expect(result).toContain('switchTo().frame(3)');
      expect(result).toContain(`By.css('[data-se-ref="e15"]')`);
    });
  });

  // --- v0.3: Cross-frame ref resolution ---

  describe('findElement with cross-frame refs', () => {
    it('switches to iframe and finds element by ref', async () => {
      const mockIframe = { tagName: 'IFRAME' };
      const driver = makeMockDriver({ scriptResult: mockIframe });
      const el = await findElement(driver, 'f0e1');
      expect(el).toBeTruthy();
      // executeScript called to find the iframe
      expect(driver.executeScript).toHaveBeenCalled();
      // switchTo().frame() called with the iframe element
      expect(driver.switchTo).toHaveBeenCalled();
      // findElement called with By.css for the ref
      expect(driver.findElement).toHaveBeenCalled();
    });

    it('throws when iframe not found', async () => {
      const driver = makeMockDriver();
      driver.executeScript = vi.fn(async () => null);
      await expect(findElement(driver, 'f99e1')).rejects.toThrow('Frame f99 not found');
    });

    it('falls back to shadow root search when element not in light DOM', async () => {
      // Mock findElement to throw for the first call, then executeScript returns element
      const mockEl = { click: vi.fn() };
      const driver = makeMockDriver({ scriptResult: mockEl });
      driver.findElement = vi.fn(async () => { throw new Error('NoSuchElementError'); });
      const el = await findElement(driver, 'e1');
      expect(el).toBe(mockEl);
      // executeScript should have been called for shadow root search
      expect(driver.executeScript).toHaveBeenCalled();
    });
  });

  describe('safeFilename', () => {
    it('accepts normal filename', () => {
      expect(safeFilename('test.png')).toBe('test.png');
    });

    it('accepts filename with dots', () => {
      expect(safeFilename('my.snapshot.2024.png')).toBe('my.snapshot.2024.png');
    });

    it('rejects path traversal with ../', () => {
      expect(() => safeFilename('../evil.png')).toThrow();
    });

    it('rejects deeper path traversal', () => {
      expect(() => safeFilename('../../etc/passwd')).toThrow();
    });

    it('rejects absolute unix path', () => {
      expect(() => safeFilename('/etc/passwd')).toThrow();
    });

    it('rejects absolute windows path with backslash', () => {
      expect(() => safeFilename('\\windows\\system32\\evil.dll')).toThrow();
    });

    it('rejects path with subdirectory', () => {
      expect(() => safeFilename('subdir/evil.png')).toThrow();
    });
  });

  // ── Missing tool coverage tests ──────────────────────────

  describe('browser_find', () => {
    it('searches snapshot text and returns matches', async () => {
      const driver = makeMockDriver({ scriptResult: '- textbox "Search" [ref=e1]\n- button "Submit" [ref=e2]' });
      const response = new Response({ raw: false, json: false });
      await browser_find(driver, { text: 'Submit' }, response);
      const out = response.serialize();
      expect(out).toContain('Submit');
    });

    it('returns no matches when text not found', async () => {
      const driver = makeMockDriver({ scriptResult: '- textbox "Search" [ref=e1]' });
      const response = new Response({ raw: false, json: false });
      await browser_find(driver, { text: 'NonExistent' }, response);
      const out = response.serialize();
      expect(out).toContain('No matches');
    });

    it('supports regex search', async () => {
      const driver = makeMockDriver({ scriptResult: '- link "Home" [ref=e1]\n- link "About" [ref=e2]' });
      const response = new Response({ raw: false, json: false });
      await browser_find(driver, { regex: 'link' }, response);
      const out = response.serialize();
      expect(out).toContain('link');
    });
  });

  describe('browser_select', () => {
    it('routes to browser_select in parseCommand', () => {
      const r = parseCommand(['select', 'e1', 'option1']);
      expect(r.toolName).toBe('browser_select');
      expect(r.toolParams.target).toBe('e1');
      expect(r.toolParams.value).toBe('option1');
    });
  });

  describe('browser_check', () => {
    it('calls findElement and click for unchecked checkbox', async () => {
      const driver = makeMockDriver({});
      const mockEl = {
        click: vi.fn(async () => {}),
        getAttribute: vi.fn(async () => 'false'),
        isSelected: vi.fn(async () => false),
      };
      driver.findElement = vi.fn(async () => mockEl);
      const response = new Response({ raw: false, json: false });
      await browser_check(driver, { target: 'e1' }, response);
      const out = response.serialize();
      expect(out).toContain('checked');
    });
  });

  describe('browser_uncheck', () => {
    it('calls findElement and click for checked checkbox', async () => {
      const driver = makeMockDriver({});
      const mockEl = {
        click: vi.fn(async () => {}),
        getAttribute: vi.fn(async () => 'true'),
        isSelected: vi.fn(async () => true),
      };
      driver.findElement = vi.fn(async () => mockEl);
      const response = new Response({ raw: false, json: false });
      await browser_uncheck(driver, { target: 'e1' }, response);
      const out = response.serialize();
      expect(out).toContain('unchecked');
    });
  });

  describe('browser_type', () => {
    it('sends keys to active element via switchTo activeElement', async () => {
      const driver = makeMockDriver({});
      const mockEl = { sendKeys: vi.fn(async () => {}) };
      // activeElement() must return the element directly (WebElement is thenable
      // in selenium-webdriver — methods are accessible without await)
      driver.switchTo = vi.fn(() => ({ activeElement: vi.fn(() => mockEl) }));
      const response = new Response({ raw: false, json: false });
      await browser_type(driver, { value: 'hello' }, response);
      const out = response.serialize();
      expect(out).toContain('typed');
      expect(mockEl.sendKeys).toHaveBeenCalledWith('hello');
    });
  });

  describe('browser_press', () => {
    it('sends key to active element', async () => {
      const driver = makeMockDriver({});
      const mockEl = { sendKeys: vi.fn(async () => {}) };
      driver.switchTo = vi.fn(() => ({ activeElement: vi.fn(() => mockEl) }));
      const response = new Response({ raw: false, json: false });
      await browser_press(driver, { key: 'Enter' }, response);
      const out = response.serialize();
      expect(out).toContain('Enter');
    });

    it('emits the correct Key constant name for multi-word keys', async () => {
      // Regression: `press ArrowDown` generated `Key.ARROWDOWN`, which does
      // not exist — the real Selenium constant is `Key.ARROW_DOWN`.
      const driver = makeMockDriver({});
      const mockEl = { sendKeys: vi.fn(async () => {}) };
      driver.switchTo = vi.fn(() => ({ activeElement: vi.fn(() => mockEl) }));
      const response = new Response({ raw: false, json: false });
      await browser_press(driver, { key: 'ArrowDown' }, response);
      const out = response.serialize();
      expect(out).toContain('Key.ARROW_DOWN');
      expect(out).not.toContain('Key.ARROWDOWN');
    });
  });

  describe('browser_go_back', () => {
    it('calls driver.navigate().back()', async () => {
      const driver = makeMockDriver({});
      const response = new Response({ raw: false, json: false });
      await browser_go_back(driver, {}, response);
      const out = response.serialize();
      expect(out).toContain('navigate');
    });
  });

  describe('browser_go_forward', () => {
    it('calls driver.navigate().forward()', async () => {
      const driver = makeMockDriver({});
      const response = new Response({ raw: false, json: false });
      await browser_go_forward(driver, {}, response);
      const out = response.serialize();
      expect(out).toContain('navigate');
    });
  });

  describe('browser_reload', () => {
    it('calls driver.navigate().refresh()', async () => {
      const driver = makeMockDriver({});
      const response = new Response({ raw: false, json: false });
      await browser_reload(driver, {}, response);
      const out = response.serialize();
      expect(out).toContain('reloaded');
    });
  });

  describe('browser_url', () => {
    it('returns current URL', async () => {
      const driver = makeMockDriver({ url: 'https://test.example.com/page' });
      const response = new Response({ raw: false, json: false });
      await browser_url(driver, {}, response);
      const out = response.serialize();
      expect(out).toContain('https://test.example.com/page');
    });
  });

  describe('AssertionError', () => {
    it('carries structured metadata (matcher, expected, actual, not)', () => {
      const err = new AssertionError('test message', 'visible', 'true', 'false', true);
      expect(err.matcher).toBe('visible');
      expect(err.expected).toBe('true');
      expect(err.actual).toBe('false');
      expect(err.not).toBe(true);
      expect(err.message).toBe('test message');
      expect(err.name).toBe('AssertionError');
    });

    it('toJSON returns structured object', () => {
      const err = new AssertionError('msg', 'text', 'hello', 'world', false);
      const json = err.toJSON();
      expect(json.name).toBe('AssertionError');
      expect(json.matcher).toBe('text');
      expect(json.expected).toBe('hello');
      expect(json.actual).toBe('world');
      expect(json.not).toBe(false);
    });

    it('works with minimal args (message only)', () => {
      const err = new AssertionError('simple error');
      expect(err.message).toBe('simple error');
      expect(err.matcher).toBeUndefined();
      expect(err.expected).toBeUndefined();
      expect(err.actual).toBeUndefined();
      expect(err.not).toBeUndefined();
    });
  });
});

describe('tool handlers', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-tools-'));
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  describe('browser_goto', () => {
    it('calls driver.get and adds page meta and code', async () => {
      const driver = makeMockDriver({ title: 'Example', url: 'https://example.com' });
      const response = new Response({ raw: false, json: false });
      await browser_goto(driver, { url: 'https://example.com' }, response);
      expect(driver.get).toHaveBeenCalledWith('https://example.com');
      expect(driver.getTitle).toHaveBeenCalled();
      expect(driver.getCurrentUrl).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('### Page');
      expect(out).toContain('https://example.com');
      expect(out).toContain('Example');
      expect(out).toContain('### Ran Selenium code');
      expect(out).toContain("await driver.get('https://example.com')");
      expect(out).toContain('### Result');
      expect(out).toContain('navigated to https://example.com');
    });
  });

  describe('browser_title', () => {
    it('calls getTitle and adds result', async () => {
      const driver = makeMockDriver({ title: 'My Page' });
      const response = new Response({ raw: false, json: false });
      await browser_title(driver, {}, response);
      expect(driver.getTitle).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('My Page');
    });
  });

  describe('browser_click', () => {
    it('calls findElement and click, adds page meta and role-based code (v0.9)', async () => {
      const driver = makeMockDriver({ title: 'Clicked Page', url: 'https://example.com/clicked' });
      const response = new Response({ raw: false, json: false });
      await browser_click(driver, { target: 'e1' }, response);
      expect(driver.findElement).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('### Page');
      expect(out).toContain('Clicked Page');
      expect(out).toContain('### Ran Selenium code');
      expect(out).toContain(`new By('role', { role: 'button', name: 'Save Draft' })`);
      expect(out).toContain('.click()');
      expect(out).toContain('clicked');
    });

    it('emits data-se-ref code with --locator-style=ref', async () => {
      const driver = makeMockDriver({ title: 'Clicked Page', url: 'https://example.com/clicked' });
      const response = new Response({ raw: false, json: false });
      await browser_click(driver, { target: 'e1', locatorStyle: 'ref' }, response);
      const out = response.serialize();
      expect(out).toContain(`By.css('[data-se-ref="e1"]')`);
    });

    it('falls back to CSS when the role locator is ambiguous', async () => {
      const driver = makeMockDriver({ title: 'Page', url: 'https://example.com', matchCount: 2, roleMatchCount: 2 });
      const response = new Response({ raw: false, json: false });
      await browser_click(driver, { target: 'e1' }, response);
      const out = response.serialize();
      expect(out).toContain('role locator was ambiguous (2 matches); fell back to CSS');
      expect(out).toContain(`By.css('button.btn')`);
    });

    it('uses CSS selector when target is not a ref', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_click(driver, { target: 'a.button' }, response);
      const out = response.serialize();
      expect(out).toContain(`new By('role', { role: 'button', name: 'Save Draft' })`);
    });
  });

  describe('browser_fill', () => {
    it('calls findElement, clear, sendKeys and adds role-based code', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_fill(driver, { target: 'e1', value: 'hello' }, response);
      expect(driver.findElement).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain(`new By('role', { role: 'button', name: 'Save Draft' })`);
      expect(out).toContain('sendKeys');
      expect(out).toContain("'hello'");
      expect(out).toContain('filled');
    });

    it('escapes quotes and newlines in emitted code', async () => {
      // Regression: values containing single quotes or newlines produced
      // invalid "Ran Selenium code" (unterminated string literal).
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_fill(driver, { target: 'e1', value: "it's a test\nline2" }, response);
      const out = response.serialize();
      expect(out).toContain(`sendKeys('it\\'s a test\\nline2')`);
      // The emitted code must be a valid JS string literal
      expect(out).not.toMatch(/sendKeys\('it's/);
    });

    it('does not send ENTER when submit is not set', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_fill(driver, { target: 'e1', value: 'hello' }, response);
      // The mock element's sendKeys should be called once (with 'hello')
      const el = await driver.findElement.mock.results[0].value;
      expect(el.sendKeys).toHaveBeenCalledTimes(1);
      expect(el.sendKeys).toHaveBeenCalledWith('hello');
    });

    it('captures the locator codegen BEFORE filling (submit may navigate)', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_fill(driver, { target: 'e1', value: 'hello', submit: true }, response);
      const el = await driver.findElement.mock.results[0].value;
      // codegen runs via executeScript (locator heuristics) — must happen
      // before any sendKeys so a form submission cannot stale the element.
      const codegenCall = driver.executeScript.mock.invocationCallOrder[0];
      const sendKeysCall = el.sendKeys.mock.invocationCallOrder[0];
      expect(codegenCall).toBeLessThan(sendKeysCall);
    });

    it('sends ENTER when submit=true', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_fill(driver, { target: 'e1', value: 'hello', submit: true }, response);
      const el = await driver.findElement.mock.results[0].value;
      // sendKeys called twice: once with 'hello', once with Key.ENTER
      expect(el.sendKeys).toHaveBeenCalledTimes(2);
    });
  });

  describe('browser_snapshot', () => {
    it('calls executeScript and adds result yaml', async () => {
      const yaml = '- link:\n  - More information... [ref=e1]';
      const driver = makeMockDriver({ scriptResult: yaml });
      const response = new Response({ raw: false, json: false });
      await browser_snapshot(driver, {}, response);
      expect(driver.executeScript).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain(yaml);
    });

    it('writes yaml to file when filename is given', async () => {
      const yaml = '- link:\n  - More information... [ref=e1]';
      const driver = makeMockDriver({ scriptResult: yaml });
      const response = new Response({ raw: false, json: false });
      await browser_snapshot(driver, { filename: 'snap.yml' }, response);
      const file = path.join(tmpCwd, '.se-cli', 'snap.yml');
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).toBe(yaml);
      const out = response.serialize();
      expect(out).toContain('[Snapshot](.se-cli/snap.yml)');
    });
  });

  describe('browser_screenshot', () => {
    it('calls takeScreenshot, writes file, adds result', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_screenshot(driver, { filename: 'shot.png' }, response);
      expect(driver.takeScreenshot).toHaveBeenCalled();
      const file = path.join(tmpCwd, '.se-cli', 'shot.png');
      expect(fs.existsSync(file)).toBe(true);
      // base64 'BASE64PNG' decoded should be a non-empty buffer
      const stat = fs.statSync(file);
      expect(stat.size).toBeGreaterThan(0);
      const out = response.serialize();
      expect(out).toContain('[Screenshot](.se-cli/shot.png)');
      expect(out).toContain('takeScreenshot');
    });

    it('uses element screenshot when target is given', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_screenshot(driver, { target: 'e1', filename: 'el.png' }, response);
      expect(driver.findElement).toHaveBeenCalled();
      const file = path.join(tmpCwd, '.se-cli', 'el.png');
      expect(fs.existsSync(file)).toBe(true);
      const out = response.serialize();
      expect(out).toContain("findElement(By.css('[data-se-ref=\"e1\"]')).takeScreenshot()");
      expect(out).toContain("writeFileSync('el.png'");
    });

    it('generates default filename when not given', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_screenshot(driver, {}, response);
      const dir = path.join(tmpCwd, '.se-cli');
      const files = fs.readdirSync(dir).filter(f => f.startsWith('screenshot-') && f.endsWith('.png'));
      expect(files.length).toBe(1);
    });

    // ── v0.13: BiDi browsingContext.captureScreenshot path ──

    it('captures via BiDi browsingContext.captureScreenshot when --bidi is set', async () => {
      const send = vi.fn(async () => ({ result: { data: 'BASE64PNG' } }));
      const driver = makeMockDriver();
      driver.getWindowHandle = vi.fn(async () => 'context-1');
      driver.getBidi = vi.fn(async () => ({ send }));
      const response = new Response({ raw: false, json: false });

      await browser_screenshot(driver, { filename: 'bidi.png', bidi: true }, response);

      expect(driver.takeScreenshot).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith({
        method: 'browsingContext.captureScreenshot',
        params: { context: 'context-1', origin: 'viewport' },
      });
      const file = path.join(tmpCwd, '.se-cli', 'bidi.png');
      expect(fs.existsSync(file)).toBe(true);
      expect(response.serialize()).toContain('[Screenshot](.se-cli/bidi.png)');
    });

    it('fails clearly when BiDi is unavailable for screenshot --bidi', async () => {
      const driver = makeMockDriver();
      driver.getBidi = vi.fn(async () => { throw new Error('no webSocketUrl'); });
      const response = new Response({ raw: false, json: false });

      await expect(browser_screenshot(driver, { bidi: true }, response)).rejects.toThrow(/BiDi/);
    });
  });

  describe('browser_eval', () => {
    it('calls executeScript and adds result', async () => {
      const driver = makeMockDriver({ scriptResult: 'Example Domain' });
      const response = new Response({ raw: false, json: false });
      await browser_eval(driver, { script: 'document.title' }, response);
      expect(driver.executeScript).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('Example Domain');
      expect(out).toContain('document.title');
    });

    it('handles object result by JSON-stringifying', async () => {
      const driver = makeMockDriver({ scriptResult: { a: 1, b: 2 } });
      const response = new Response({ raw: false, json: false });
      await browser_eval(driver, { script: 'return {a:1,b:2}' }, response);
      const out = response.serialize();
      expect(out).toContain('"a":1');
      expect(out).toContain('"b":2');
    });

    it('passes element when target is given', async () => {
      const driver = makeMockDriver({ scriptResult: 'clicked' });
      const response = new Response({ raw: false, json: false });
      await browser_eval(driver, { script: 'arguments[0].click()', target: 'e1' }, response);
      expect(driver.findElement).toHaveBeenCalled();
      // executeScript should have been called with (script, el)
      const callArgs = driver.executeScript.mock.calls[0];
      expect(callArgs[0]).toBe('arguments[0].click()');
      expect(callArgs[1]).toBeTruthy();
    });

    it('falls back to verbatim execution for statement-style scripts', async () => {
      // `var x = 1; x` is not a valid expression under `return (...);` —
      // the tool must fall back to executing the script verbatim.
      const driver = makeMockDriver({ scriptResult: 42 });
      driver.executeScript = vi.fn()
        .mockRejectedValueOnce(new SyntaxError('Unexpected token'))
        .mockResolvedValueOnce(42);
      const response = new Response({ raw: false, json: false });
      await browser_eval(driver, { script: 'var x = 42; x' }, response);
      expect(driver.executeScript).toHaveBeenCalledTimes(2);
      expect(driver.executeScript.mock.calls[1][0]).toBe('var x = 42; x');
      expect(response.serialize()).toContain('42');
    });

    it('registers a returned WebElement as a ref', async () => {
      const webElement = {
        getId: vi.fn(async () => 'web-elem-1'),
        click: vi.fn(async () => {}),
        getTagName: vi.fn(async () => 'button'),
      };
      const driver = makeMockDriver({ scriptResult: webElement });
      // maxExistingRef query returns the current max ref (0)
      const response = new Response({ raw: false, json: false });
      await browser_eval(driver, { script: 'document.querySelector("button")' }, response);
      expect(response.serialize()).toContain('e1');
      // setAttribute call assigns the ref
      const setAttrCalls = driver.executeScript.mock.calls.filter((c: any[]) => String(c[0]).includes('setAttribute'));
      expect(setAttrCalls.length).toBeGreaterThan(0);
      expect(setAttrCalls[0][2]).toBe('e1');
    });
  });

  // --- v0.2: Storage management ---
  describe('browser_cookie_list', () => {
    it('calls manage().getCookies() and returns JSON', async () => {
      const driver = makeMockDriver({ cookies: [{ name: 'session', value: 'abc' }] });
      const response = new Response({ raw: false, json: false });
      await browser_cookie_list(driver, {}, response);
      const out = response.serialize();
      expect(out).toContain('session');
      expect(out).toContain('abc');
    });
  });

  describe('browser_cookie_get', () => {
    it('calls manage().getCookie(name) and returns value', async () => {
      const driver = makeMockDriver({ cookies: [{ name: 'token', value: 'xyz' }] });
      const response = new Response({ raw: false, json: false });
      await browser_cookie_get(driver, { name: 'token' }, response);
      const out = response.serialize();
      expect(out).toContain('token');
      expect(out).toContain('xyz');
    });
  });

  describe('browser_cookie_set', () => {
    it('calls manage().addCookie()', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_cookie_set(driver, { name: 'foo', value: 'bar' }, response);
      expect(driver.manage).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('addCookie');
    });
  });

  describe('browser_cookie_delete', () => {
    it('calls deleteCookie when name is given', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_cookie_delete(driver, { name: 'foo' }, response);
      const out = response.serialize();
      expect(out).toContain('deleteCookie');
    });

    it('calls deleteAllCookies when name is omitted', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_cookie_delete(driver, {}, response);
      const out = response.serialize();
      expect(out).toContain('deleteAllCookies');
    });
  });

  describe('browser_localstorage_get', () => {
    it('calls executeScript to get item', async () => {
      const driver = makeMockDriver({ scriptResult: 'dark' });
      const response = new Response({ raw: false, json: false });
      await browser_localstorage_get(driver, { key: 'theme' }, response);
      expect(driver.executeScript).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('dark');
    });
  });

  describe('browser_localstorage_set', () => {
    it('calls executeScript to set item', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_localstorage_set(driver, { key: 'theme', value: 'dark' }, response);
      expect(driver.executeScript).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('localStorage');
    });
  });

  describe('browser_localstorage_delete', () => {
    it('calls executeScript to remove item', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_localstorage_delete(driver, { key: 'theme' }, response);
      expect(driver.executeScript).toHaveBeenCalled();
    });

    it('calls executeScript to clear all when no key', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_localstorage_delete(driver, {}, response);
      expect(driver.executeScript).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('clear');
    });
  });

  describe('browser_localstorage_list', () => {
    it('calls executeScript to list keys', async () => {
      const driver = makeMockDriver({ scriptResult: { theme: 'dark', lang: 'en' } });
      const response = new Response({ raw: false, json: false });
      await browser_localstorage_list(driver, {}, response);
      expect(driver.executeScript).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('theme');
      expect(out).toContain('dark');
    });
  });

  describe('browser_sessionstorage_get', () => {
    it('calls executeScript to get item', async () => {
      const driver = makeMockDriver({ scriptResult: 'tempval' });
      const response = new Response({ raw: false, json: false });
      await browser_sessionstorage_get(driver, { key: 'temp' }, response);
      expect(driver.executeScript).toHaveBeenCalled();
    });
  });

  describe('browser_sessionstorage_set', () => {
    it('calls executeScript to set item', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_sessionstorage_set(driver, { key: 'temp', value: 'val' }, response);
      expect(driver.executeScript).toHaveBeenCalled();
    });
  });

  // --- v0.2: Tab management ---
  describe('browser_tab_list', () => {
    it('calls getAllWindowHandles and returns tab info', async () => {
      const driver = makeMockDriver({ windowHandles: ['w1', 'w2'], title: 'Tab1', url: 'https://example.com' });
      const response = new Response({ raw: false, json: false });
      await browser_tab_list(driver, {}, response);
      expect(driver.getAllWindowHandles).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('w1');
      expect(out).toContain('w2');
    });

    it('restores the original window context when a tab query fails', async () => {
      // Regression: if getTitle/getCurrentUrl throws mid-iteration on a
      // NON-original window, the driver must still be switched back to the
      // original window — otherwise it is left on a stale/dead handle and
      // subsequent commands fail.
      const switchCalls: string[] = [];
      const driver = makeMockDriver({ windowHandles: ['w1', 'w2'], title: 'Tab1', url: 'https://example.com' });
      driver.getWindowHandle = vi.fn(async () => 'w1'); // original is w1
      driver.getAllWindowHandles = vi.fn(async () => ['w1', 'w2']);
      driver.switchTo = vi.fn(() => ({
        window: vi.fn(async (h: string) => { switchCalls.push(h); }),
      }));
      driver.getTitle = vi.fn(async () => {
        if (switchCalls.length >= 2) throw new Error('invalid window handle'); // fails on w2
        return 'Tab1';
      });
      const response = new Response({ raw: false, json: false });
      await expect(browser_tab_list(driver, {}, response)).rejects.toThrow('invalid window handle');
      // last switch must be back to the original handle, not left on w2
      expect(switchCalls[switchCalls.length - 1]).toBe('w1');
    });
  });

  describe('browser_tab_new', () => {
    it('calls switchTo().newWindow', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_tab_new(driver, {}, response);
      expect(driver.switchTo).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('newWindow');
    });

    it('navigates to url when provided', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_tab_new(driver, { url: 'https://example.com' }, response);
      expect(driver.get).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('browser_tab_close', () => {
    it('calls driver.close() and switches to remaining handle', async () => {
      const driver = makeMockDriver({ windowHandles: ['w2'] });
      const response = new Response({ raw: false, json: false });
      await browser_tab_close(driver, {}, response);
      expect(driver.close).toHaveBeenCalled();
    });
  });

  describe('browser_tab_select', () => {
    it('calls getAllWindowHandles and switchTo() for tab selection', async () => {
      const driver = makeMockDriver({ windowHandles: ['w1', 'w2', 'w3'] });
      const response = new Response({ raw: false, json: false });
      await browser_tab_select(driver, { index: 1 }, response);
      expect(driver.getAllWindowHandles).toHaveBeenCalled();
      expect(driver.switchTo).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('handles[1]');
    });
  });

  // --- v0.2: State save/load ---
  describe('browser_state_save', () => {
    it('saves cookies and storage to JSON file', async () => {
      const driver = makeMockDriver({ cookies: [{ name: 'session', value: 'abc' }] });
      const response = new Response({ raw: false, json: false });
      await browser_state_save(driver, { filename: 'state.json' }, response);
      const file = path.join(tmpCwd, '.se-cli', 'state.json');
      expect(fs.existsSync(file)).toBe(true);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(data.cookies).toBeInstanceOf(Array);
      expect(data.url).toBe('https://example.com');
    });
  });

  describe('browser_state_load', () => {
    it('loads state from JSON file', async () => {
      // First save
      const driver = makeMockDriver({ cookies: [{ name: 'session', value: 'abc', domain: 'example.com', path: '/' }] });
      await browser_state_save(driver, { filename: 'state.json' }, new Response({ raw: false, json: false }));
      // Then load
      const driver2 = makeMockDriver({ cookies: [{ name: 'session', value: 'abc', domain: 'example.com', path: '/' }] });
      const response = new Response({ raw: false, json: false });
      await browser_state_load(driver2, { filename: 'state.json' }, response);
      const out = response.serialize();
      expect(out).toContain('cookies');
    });
  });
});
