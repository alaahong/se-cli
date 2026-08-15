import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Response } from '../../src/response';
import {
  normalizePreloadScript,
  preloadRegistry,
  browser_preload_add,
  browser_preload_remove,
  browser_preload_list,
} from '../../src/daemon/tools/preload';

function freshResponse(): Response {
  return new Response({ raw: false, json: false });
}

/** Mock driver whose script() returns a stubbed Script domain. */
function mockDriver(pin: ReturnType<typeof vi.fn>, unpin: ReturnType<typeof vi.fn>) {
  return { script: () => ({ pin, unpin }) } as any;
}

describe('normalizePreloadScript', () => {
  it('wraps bare code in a function declaration', () => {
    expect(normalizePreloadScript("window.__preload = 1")).toBe(
      "function() {\nwindow.__preload = 1\n}",
    );
  });

  it('passes function declarations through unchanged', () => {
    const decl = '() => { window.__preload = 2 }';
    expect(normalizePreloadScript(decl)).toBe(decl);
    const fn = 'function() { console.log("x") }';
    expect(normalizePreloadScript(fn)).toBe(fn);
  });

  it('rejects empty or whitespace-only scripts', () => {
    expect(() => normalizePreloadScript('')).toThrow(/script is required/);
    expect(() => normalizePreloadScript('   ')).toThrow(/script is required/);
  });
});

describe('browser_preload_add', () => {
  beforeEach(() => {
    preloadRegistry.clear();
  });

  it('registers a preload script and reports its id', async () => {
    const pin = vi.fn().mockResolvedValue('preload-1');
    const driver = mockDriver(pin, vi.fn());
    const r = freshResponse();
    await browser_preload_add(driver, { script: "window.__p = 1" }, r);
    expect(pin).toHaveBeenCalledWith('function() {\nwindow.__p = 1\n}');
    expect(preloadRegistry.has('preload-1')).toBe(true);
    expect(r.getError()).toBeUndefined();
    expect(JSON.stringify(r.serialize())).toContain('preload-1');
  });

  it('requires a script argument', async () => {
    const r = freshResponse();
    await expect(browser_preload_add(mockDriver(vi.fn(), vi.fn()), {}, r)).rejects.toThrow(/script is required/);
  });

  it('surfaces BiDi-unavailable errors with a clear message', async () => {
    const driver = { script: () => { throw new Error('This driver does not support BiDi'); } } as any;
    const r = freshResponse();
    await expect(browser_preload_add(driver, { script: 'x' }, r)).rejects.toThrow(/BiDi/);
  });

  it('rejects drivers whose script() lacks a pin method', async () => {
    // e.g. a session where the BiDi WebSocket was never established.
    const driver = { script: () => ({}) } as any;
    const r = freshResponse();
    await expect(browser_preload_add(driver, { script: 'x' }, r)).rejects.toThrow(/BiDi/);
  });
});

describe('browser_preload_remove', () => {
  beforeEach(() => {
    preloadRegistry.clear();
  });

  it('unpins the script and drops it from the registry', async () => {
    const unpin = vi.fn().mockResolvedValue(undefined);
    preloadRegistry.set('preload-1', { script: 'function() {}' });
    const r = freshResponse();
    await browser_preload_remove(mockDriver(vi.fn(), unpin), { id: 'preload-1' }, r);
    expect(unpin).toHaveBeenCalledWith('preload-1');
    expect(preloadRegistry.has('preload-1')).toBe(false);
    expect(r.getError()).toBeUndefined();
  });

  it('requires an id argument', async () => {
    const r = freshResponse();
    await expect(browser_preload_remove(mockDriver(vi.fn(), vi.fn()), {}, r)).rejects.toThrow(/id is required/);
  });

  it('drops stale registry entries when the browser session was reset', async () => {
    // After a driver reset the BiDi script id is invalid; remove should still
    // clean up the registry and warn instead of failing hard.
    const unpin = vi.fn().mockRejectedValue(new Error('script not found'));
    preloadRegistry.set('stale-1', { script: 'function() {}' });
    const r = freshResponse();
    await browser_preload_remove(mockDriver(vi.fn(), unpin), { id: 'stale-1' }, r);
    expect(preloadRegistry.has('stale-1')).toBe(false);
    expect(JSON.stringify(r.serialize())).toContain('stale-1');
  });

  it('reports when the id is not in the local registry', async () => {
    const unpin = vi.fn().mockResolvedValue(undefined);
    const r = freshResponse();
    await browser_preload_remove(mockDriver(vi.fn(), unpin), { id: 'ghost-1' }, r);
    expect(JSON.stringify(r.serialize())).toContain('no local registry entry');
  });
});

describe('browser_preload_list', () => {
  beforeEach(() => {
    preloadRegistry.clear();
  });

  it('lists registered scripts with their ids', async () => {
    preloadRegistry.set('a', { script: 'function() { window.x = 1 }' });
    preloadRegistry.set('b', { script: '() => {}' });
    const r = freshResponse();
    await browser_preload_list({} as any, {}, r);
    const text = r.serialize();
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(text).toContain('window.x = 1');
  });

  it('reports an empty registry', async () => {
    const r = freshResponse();
    await browser_preload_list({} as any, {}, r);
    expect(JSON.stringify(r.serialize())).toContain('no preload scripts');
  });
});
