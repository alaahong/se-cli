import { describe, it, expect, vi } from 'vitest';
import { Response } from '../../src/response';
import {
  browser_context_new,
  browser_context_close,
  browser_context_list,
} from '../../src/daemon/tools/context';

function freshResponse(): Response {
  return new Response({ raw: false, json: false });
}

/** Mock driver whose getBidi() returns a stubbed BiDi connection. */
function mockDriver(send: ReturnType<typeof vi.fn>) {
  return { getBidi: async () => ({ send }) } as any;
}

describe('browser_context_new', () => {
  it('creates a user context and reports its id', async () => {
    const send = vi.fn().mockResolvedValue({ result: { userContext: 'ctx-1' } });
    const r = freshResponse();
    await browser_context_new(mockDriver(send), {}, r);
    expect(send).toHaveBeenCalledWith({ method: 'browser.createUserContext', params: {} });
    expect(r.getError()).toBeUndefined();
    expect(JSON.stringify(r.serialize())).toContain('ctx-1');
  });

  it('surfaces BiDi errors', async () => {
    const send = vi.fn().mockResolvedValue({ error: { message: 'not supported' } });
    const r = freshResponse();
    await expect(browser_context_new(mockDriver(send), {}, r)).rejects.toThrow(/createUserContext/);
  });

  it('rejects drivers without BiDi', async () => {
    const driver = { getBidi: async () => { throw new Error('no webSocketUrl'); } } as any;
    const r = freshResponse();
    await expect(browser_context_new(driver, {}, r)).rejects.toThrow(/BiDi/);
  });
});

describe('browser_context_list', () => {
  it('lists user contexts', async () => {
    const send = vi.fn().mockResolvedValue({
      result: { userContexts: [{ userContext: 'ctx-1' }, { userContext: 'ctx-2' }] },
    });
    const r = freshResponse();
    await browser_context_list(mockDriver(send), {}, r);
    expect(send).toHaveBeenCalledWith({ method: 'browser.getUserContexts', params: {} });
    const text = r.serialize();
    expect(text).toContain('ctx-1');
    expect(text).toContain('ctx-2');
  });

  it('reports when only the default context exists', async () => {
    const send = vi.fn().mockResolvedValue({ result: { userContexts: [{ userContext: 'default' }] } });
    const r = freshResponse();
    await browser_context_list(mockDriver(send), {}, r);
    expect(r.getError()).toBeUndefined();
  });

  it('reports when no user contexts are returned', async () => {
    const send = vi.fn().mockResolvedValue({ result: { userContexts: [] } });
    const r = freshResponse();
    await browser_context_list(mockDriver(send), {}, r);
    expect(JSON.stringify(r.serialize())).toContain('no user contexts');
  });
});

describe('browser_context_close', () => {
  it('removes a user context by id', async () => {
    const send = vi.fn().mockResolvedValue({ result: {} });
    const r = freshResponse();
    await browser_context_close(mockDriver(send), { id: 'ctx-1' }, r);
    expect(send).toHaveBeenCalledWith({
      method: 'browser.removeUserContext',
      params: { userContext: 'ctx-1' },
    });
    expect(JSON.stringify(r.serialize())).toContain('ctx-1');
  });

  it('requires an id argument', async () => {
    const r = freshResponse();
    await expect(browser_context_close(mockDriver(vi.fn()), {}, r)).rejects.toThrow(/id is required/);
  });
});
