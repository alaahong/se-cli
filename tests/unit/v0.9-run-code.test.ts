import { describe, it, expect, vi } from 'vitest';
import { Response } from '../../src/response';
import {
  browser_run_code,
  serializeValue,
  nextRefNumber,
  isWebElement,
} from '../../src/daemon/tools/run-code';
import { parseCommand } from '../../src/daemon/backend';

function makeMockDriver(opts: any = {}): any {
  const calls: any[] = [];
  const driver = {
    executeScript: vi.fn(async (...args: any[]) => {
      calls.push({ method: 'executeScript', args });
      return opts.maxRef;
    }),
    _calls: calls,
  };
  return driver;
}

function fakeElement(id = 'abc'): any {
  return {
    getId: vi.fn(async () => id),
    click: vi.fn(async () => {}),
  };
}

describe('parseCommand: run-code', () => {
  it('maps run-code to browser_run_code with code', () => {
    const r = parseCommand(['run-code', 'async driver => { return 1; }']);
    expect(r.toolName).toBe('browser_run_code');
    expect(r.toolParams).toEqual({ code: 'async driver => { return 1; }' });
  });
});

describe('isWebElement', () => {
  it('accepts real WebElement instances', () => {
    const { WebElement } = require('selenium-webdriver');
    const el = new WebElement(
      { execute: async () => ({}) } as any,
      'fake-id'
    );
    expect(isWebElement(el)).toBe(true);
  });

  it('accepts duck-typed elements (getId + click)', () => {
    expect(isWebElement(fakeElement())).toBe(true);
  });

  it('rejects primitives, arrays, and plain objects', () => {
    expect(isWebElement('e1')).toBe(false);
    expect(isWebElement(42)).toBe(false);
    expect(isWebElement(null)).toBe(false);
    expect(isWebElement(undefined)).toBe(false);
    expect(isWebElement({ id: 1 })).toBe(false);
    expect(isWebElement([1, 2])).toBe(false);
  });
});

describe('nextRefNumber', () => {
  it('returns the highest existing e<N> ref', async () => {
    const driver = makeMockDriver({ maxRef: 107 });
    await expect(nextRefNumber(driver)).resolves.toBe(107);
  });

  it('returns 0 for non-numeric results', async () => {
    const driver = makeMockDriver({ maxRef: undefined });
    await expect(nextRefNumber(driver)).resolves.toBe(0);
    const driver2 = makeMockDriver({ maxRef: NaN });
    await expect(nextRefNumber(driver2)).resolves.toBe(0);
  });
});

describe('serializeValue', () => {
  it('passes primitives through as-is', async () => {
    const driver = makeMockDriver();
    expect(await serializeValue(driver, null, { n: 0 })).toBeNull();
    expect(await serializeValue(driver, undefined, { n: 0 })).toBeNull();
    expect(await serializeValue(driver, 'title', { n: 0 })).toBe('title');
    expect(await serializeValue(driver, 3.14, { n: 0 })).toBe(3.14);
    expect(await serializeValue(driver, true, { n: 0 })).toBe(true);
  });

  it('assigns sequential refs to elements, continuing after max', async () => {
    const driver = makeMockDriver({ maxRef: 42 });
    const counter = { n: await nextRefNumber(driver) };
    const el1 = fakeElement('id1');
    const el2 = fakeElement('id2');
    const out = await serializeValue(driver, [el1, el2], counter);
    expect(out).toEqual(['e43', 'e44']);
    expect(driver.executeScript).toHaveBeenCalledWith(
      'arguments[0].setAttribute("data-se-ref", arguments[1]);',
      el1,
      'e43'
    );
    expect(driver.executeScript).toHaveBeenCalledWith(
      'arguments[0].setAttribute("data-se-ref", arguments[1]);',
      el2,
      'e44'
    );
  });

  it('serializes nested objects recursively', async () => {
    const driver = makeMockDriver();
    const out = await serializeValue(driver, { a: [1, 'x', null], b: { c: true } }, { n: 0 });
    expect(out).toEqual({ a: [1, 'x', null], b: { c: true } });
  });

  it('replaces circular references with [Circular]', async () => {
    const driver = makeMockDriver();
    const obj: any = { name: 'loop' };
    obj.self = obj;
    const out = await serializeValue(driver, obj, { n: 0 });
    expect(out.name).toBe('loop');
    expect(out.self).toBe('[Circular]');
  });

  it('does not mark shared (non-circular) references as circular', async () => {
    // Regression: the same object referenced from two places is NOT a cycle.
    // A permanently-growing "seen" set falsely flagged the second reference.
    const driver = makeMockDriver();
    const shared = { x: 1 };
    const out: any = await serializeValue(driver, { a: shared, b: shared }, { n: 0 });
    expect(out.a).toEqual({ x: 1 });
    expect(out.b).toEqual({ x: 1 });
    expect(out.a).not.toBe('[Circular]');
    expect(out.b).not.toBe('[Circular]');
  });

  it('guards self-referencing arrays without infinite recursion', async () => {
    // Regression: arrays had no cycle protection — a self-referencing array
    // recursed until stack overflow (caught by the outer try/catch).
    const driver = makeMockDriver();
    const arr: any[] = [];
    arr.push(arr);
    const out: any = await serializeValue(driver, arr, { n: 0 });
    expect(out[0]).toBe('[Circular]');
  });

  it('stringifies bigint and other non-serializable values', async () => {
    const driver = makeMockDriver();
    const out = await serializeValue(driver, { big: 10n, fn: () => {} }, { n: 0 });
    expect(out.big).toBe('10');
    expect(out.fn).toBeDefined();
  });
});

describe('browser_run_code', () => {
  it('returns primitives with --raw semantics', async () => {
    const driver = makeMockDriver();
    const response = new Response({ raw: true, json: false });
    await browser_run_code(driver, { code: 'return 7;' }, response);
    expect(response.serialize()).toBe('7');
  });

  it('awaits async snippets', async () => {
    const driver = makeMockDriver();
    const response = new Response({ raw: true, json: false });
    await browser_run_code(
      driver,
      { code: 'await new Promise(r => setTimeout(r, 5)); return "done";' },
      response
    );
    expect(response.serialize()).toBe('done');
  });

  it('accepts a full async arrow function and actually invokes it', async () => {
    const driver = makeMockDriver();
    driver.getTitle = vi.fn(async () => 'Example Domain');
    const response = new Response({ raw: true, json: false });
    await browser_run_code(
      driver,
      { code: 'async driver => { return await driver.getTitle(); }' },
      response
    );
    expect(response.serialize()).toBe('Example Domain');
    expect(driver.getTitle).toHaveBeenCalledTimes(1);
  });

  it('accepts a full function declaration and actually invokes it', async () => {
    const driver = makeMockDriver();
    driver.getCurrentUrl = vi.fn(async () => 'https://example.com/');
    const response = new Response({ raw: true, json: false });
    await browser_run_code(
      driver,
      { code: 'async function(driver) { return await driver.getCurrentUrl(); }' },
      response
    );
    expect(response.serialize()).toBe('https://example.com/');
    expect(driver.getCurrentUrl).toHaveBeenCalledTimes(1);
  });

  it('receives the driver instance and serializes element results as refs', async () => {
    const driver = makeMockDriver({ maxRef: 0 });
    const fakeEl = fakeElement('body-el');
    driver.findElement = vi.fn(async () => fakeEl);
    driver.getTitle = vi.fn(async () => 'Example');
    const response = new Response({ raw: false, json: false });
    await browser_run_code(
      driver,
      {
        code:
          'const el = await driver.findElement({ css: "body" }); return { title: await driver.getTitle(), el };',
      },
      response
    );
    const out = response.serialize();
    expect(out).toContain('"title"');
    expect(out).toContain('"e1"');
    expect(out).not.toContain('### Ran Selenium code');
  });

  it('reports errors as RUN_CODE_ERROR without throwing', async () => {
    const driver = makeMockDriver();
    const response = new Response({ raw: false, json: false });
    await browser_run_code(driver, { code: 'throw new Error("boom");' }, response);
    const out = response.serialize();
    expect(out).toContain('### Error');
    expect(out).toContain('RUN_CODE_ERROR: boom');
  });

  it('reports empty code as RUN_CODE_ERROR', async () => {
    const driver = makeMockDriver();
    const response = new Response({ raw: false, json: false });
    await browser_run_code(driver, { code: '   ' }, response);
    expect(response.serialize()).toContain('RUN_CODE_ERROR: no code provided');
    await browser_run_code(driver, {}, response);
    expect(response.serialize()).toContain('RUN_CODE_ERROR: no code provided');
  });

  it('reports syntax errors as RUN_CODE_ERROR', async () => {
    const driver = makeMockDriver();
    const response = new Response({ raw: false, json: false });
    await browser_run_code(driver, { code: 'const = broken' }, response);
    expect(response.serialize()).toContain('RUN_CODE_ERROR:');
  });

  it('emits structured JSON for --json output', async () => {
    const driver = makeMockDriver();
    const response = new Response({ raw: false, json: true });
    await browser_run_code(driver, { code: 'return { a: 1 };' }, response);
    const parsed = JSON.parse(response.serialize());
    expect(parsed.result).toContain('"a"');
  });
});
