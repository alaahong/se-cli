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
import { resolveTarget, byToString, safeFilename } from '../../src/daemon/tools/shared';
import { By } from 'selenium-webdriver';

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
      return opts.scriptResult ?? '- link:\n  - More information... [ref=e1]';
    }),
    takeScreenshot: vi.fn(async () => 'BASE64PNG'),
    navigate: vi.fn(() => ({
      back: vi.fn(async () => {}),
      forward: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    })),
    switchTo: vi.fn(() => ({})),
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
    it('calls findElement and click, adds page meta and code', async () => {
      const driver = makeMockDriver({ title: 'Clicked Page', url: 'https://example.com/clicked' });
      const response = new Response({ raw: false, json: false });
      await browser_click(driver, { target: 'e1' }, response);
      expect(driver.findElement).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain('### Page');
      expect(out).toContain('Clicked Page');
      expect(out).toContain('### Ran Selenium code');
      expect(out).toContain(`By.css('[data-se-ref="e1"]')`);
      expect(out).toContain('.click()');
      expect(out).toContain('clicked');
    });

    it('uses CSS selector when target is not a ref', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_click(driver, { target: 'a.button' }, response);
      const out = response.serialize();
      expect(out).toContain(`By.css('a.button')`);
    });
  });

  describe('browser_fill', () => {
    it('calls findElement, clear, sendKeys and adds code', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_fill(driver, { target: 'e1', value: 'hello' }, response);
      expect(driver.findElement).toHaveBeenCalled();
      const out = response.serialize();
      expect(out).toContain(`By.css('[data-se-ref="e1"]')`);
      expect(out).toContain('sendKeys');
      expect(out).toContain("'hello'");
      expect(out).toContain('filled');
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
    });

    it('generates default filename when not given', async () => {
      const driver = makeMockDriver();
      const response = new Response({ raw: false, json: false });
      await browser_screenshot(driver, {}, response);
      const dir = path.join(tmpCwd, '.se-cli');
      const files = fs.readdirSync(dir).filter(f => f.startsWith('screenshot-') && f.endsWith('.png'));
      expect(files.length).toBe(1);
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
  });
});
