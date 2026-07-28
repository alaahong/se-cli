import { describe, it, expect } from 'vitest';
import { Response } from '../../src/response';

describe('Response', () => {
  it('serializes default text mode with sections', () => {
    const r = new Response({ raw: false, json: false });
    r.addPage({ url: 'https://example.com', title: 'Example' });
    r.addSnapshot('- link "Home" [ref=e1]');
    r.addCode('await driver.findElement(By.css("a")).click()');
    r.addResult('clicked');
    const out = r.serialize();
    expect(out).toContain('### Page');
    expect(out).toContain('- Page URL: https://example.com');
    expect(out).toContain('### Snapshot');
    expect(out).toContain('- link "Home" [ref=e1]');
    expect(out).toContain('### Ran Selenium code');
    expect(out).toContain('await driver.findElement(By.css("a")).click()');
    expect(out).toContain('### Result');
    expect(out).toContain('clicked');
  });

  it('serializes raw mode as value only', () => {
    const r = new Response({ raw: true, json: false });
    r.addResult('1');
    const out = r.serialize();
    expect(out).toBe('1');
  });

  it('serializes json mode as object', () => {
    const r = new Response({ raw: false, json: true });
    r.addPage({ url: 'https://example.com', title: 'Example' });
    r.addCode('await driver.findElement(By.css("a")).click()');
    r.addResult('clicked');
    const out = r.serialize();
    const parsed = JSON.parse(out);
    expect(parsed.page.url).toBe('https://example.com');
    expect(parsed.code).toEqual(['await driver.findElement(By.css("a")).click()']);
    expect(parsed.result).toBe('clicked');
  });

  it('serializes error section', () => {
    const r = new Response({ raw: false, json: false });
    r.addError('Element not found');
    const out = r.serialize();
    expect(out).toContain('### Error');
    expect(out).toContain('Element not found');
  });
});
