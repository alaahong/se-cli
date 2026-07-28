import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage, SerializedResponse } from '../../src/protocol';

describe('protocol types', () => {
  it('ClientMessage has run method with args', () => {
    const msg: ClientMessage = {
      method: 'run',
      params: { args: ['click', 'e1'], cwd: '/tmp', raw: false, json: false },
    };
    expect(msg.method).toBe('run');
    expect(msg.params.args).toEqual(['click', 'e1']);
  });

  it('ServerMessage has ok and text', () => {
    const msg: ServerMessage = { ok: true, text: 'clicked' };
    expect(msg.ok).toBe(true);
  });

  it('ServerMessage has error with code', () => {
    const msg: ServerMessage = { ok: false, error: 'not found', code: 'ELEMENT_NOT_FOUND' };
    expect(msg.code).toBe('ELEMENT_NOT_FOUND');
  });

  it('SerializedResponse has page/snapshot/code/result', () => {
    const r: SerializedResponse = {
      page: { url: 'https://example.com', title: 'Example' },
      snapshot: '- link "Home"',
      code: ['await driver.findElement(By.css("a")).click()'],
      result: 'clicked',
    };
    expect(r.page.url).toBe('https://example.com');
  });
});
