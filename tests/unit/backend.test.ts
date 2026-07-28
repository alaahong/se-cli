import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/daemon/backend';

describe('parseCommand', () => {
  it('maps goto to browser_goto with url', () => {
    const r = parseCommand(['goto', 'https://example.com']);
    expect(r.toolName).toBe('browser_goto');
    expect(r.toolParams).toEqual({ url: 'https://example.com' });
  });

  it('maps go-back to browser_go_back', () => {
    const r = parseCommand(['go-back']);
    expect(r.toolName).toBe('browser_go_back');
    expect(r.toolParams).toEqual({});
  });

  it('maps go-forward to browser_go_forward', () => {
    const r = parseCommand(['go-forward']);
    expect(r.toolName).toBe('browser_go_forward');
    expect(r.toolParams).toEqual({});
  });

  it('maps reload to browser_reload', () => {
    const r = parseCommand(['reload']);
    expect(r.toolName).toBe('browser_reload');
    expect(r.toolParams).toEqual({});
  });

  it('maps title to browser_title', () => {
    const r = parseCommand(['title']);
    expect(r.toolName).toBe('browser_title');
    expect(r.toolParams).toEqual({});
  });

  it('maps url to browser_url', () => {
    const r = parseCommand(['url']);
    expect(r.toolName).toBe('browser_url');
    expect(r.toolParams).toEqual({});
  });

  it('maps click to browser_click with target', () => {
    const r = parseCommand(['click', 'e1']);
    expect(r.toolName).toBe('browser_click');
    expect(r.toolParams).toEqual({ target: 'e1' });
  });

  it('maps fill to browser_fill with target, value, submit=undefined', () => {
    const r = parseCommand(['fill', 'e1', 'hello']);
    expect(r.toolName).toBe('browser_fill');
    expect(r.toolParams.target).toBe('e1');
    expect(r.toolParams.value).toBe('hello');
    expect(r.toolParams.submit).toBeUndefined();
  });

  it('maps type to browser_type with value', () => {
    const r = parseCommand(['type', 'hello']);
    expect(r.toolName).toBe('browser_type');
    expect(r.toolParams).toEqual({ value: 'hello' });
  });

  it('maps press to browser_press with key', () => {
    const r = parseCommand(['press', 'Enter']);
    expect(r.toolName).toBe('browser_press');
    expect(r.toolParams).toEqual({ key: 'Enter' });
  });

  it('maps select to browser_select with target and value', () => {
    const r = parseCommand(['select', 'e1', 'Option']);
    expect(r.toolName).toBe('browser_select');
    expect(r.toolParams).toEqual({ target: 'e1', value: 'Option' });
  });

  it('maps check to browser_check with target', () => {
    const r = parseCommand(['check', 'e1']);
    expect(r.toolName).toBe('browser_check');
    expect(r.toolParams).toEqual({ target: 'e1' });
  });

  it('maps uncheck to browser_uncheck with target', () => {
    const r = parseCommand(['uncheck', 'e1']);
    expect(r.toolName).toBe('browser_uncheck');
    expect(r.toolParams).toEqual({ target: 'e1' });
  });

  it('maps snapshot to browser_snapshot with target', () => {
    const r = parseCommand(['snapshot', 'e1']);
    expect(r.toolName).toBe('browser_snapshot');
    expect(r.toolParams.target).toBe('e1');
    expect(r.toolParams.depth).toBeUndefined();
    expect(r.toolParams.filename).toBeUndefined();
  });

  it('maps find to browser_find with text', () => {
    const r = parseCommand(['find', 'More information']);
    expect(r.toolName).toBe('browser_find');
    expect(r.toolParams.text).toBe('More information');
    expect(r.toolParams.regex).toBeUndefined();
  });

  it('maps screenshot to browser_screenshot with filename', () => {
    const r = parseCommand(['screenshot', '--filename=shot.png']);
    expect(r.toolName).toBe('browser_screenshot');
    expect(r.toolParams.filename).toBe('shot.png');
  });

  it('maps eval to browser_eval with script', () => {
    const r = parseCommand(['eval', 'document.title']);
    expect(r.toolName).toBe('browser_eval');
    expect(r.toolParams.script).toBe('document.title');
  });

  describe('flag parsing', () => {
    it('parses --depth=5 for snapshot', () => {
      const r = parseCommand(['snapshot', '--depth=5']);
      expect(r.toolName).toBe('browser_snapshot');
      expect(r.toolParams.depth).toBe(5);
    });

    it('parses --filename=s.yml for snapshot', () => {
      const r = parseCommand(['snapshot', '--filename=s.yml']);
      expect(r.toolName).toBe('browser_snapshot');
      expect(r.toolParams.filename).toBe('s.yml');
    });

    it('parses --regex=pattern for find', () => {
      const r = parseCommand(['find', '--regex=pattern']);
      expect(r.toolName).toBe('browser_find');
      expect(r.toolParams.regex).toBe('pattern');
    });

    it('parses --filename=shot.png for screenshot', () => {
      const r = parseCommand(['screenshot', '--filename=shot.png']);
      expect(r.toolName).toBe('browser_screenshot');
      expect(r.toolParams.filename).toBe('shot.png');
    });

    it('parses --submit flag for fill', () => {
      const r = parseCommand(['fill', 'e1', 'hello', '--submit']);
      expect(r.toolName).toBe('browser_fill');
      expect(r.toolParams.submit).toBe(true);
      expect(r.toolParams.target).toBe('e1');
      expect(r.toolParams.value).toBe('hello');
    });
  });

  it('throws on unknown command', () => {
    expect(() => parseCommand(['unknown-cmd'])).toThrow(/Unknown command/);
  });
});
