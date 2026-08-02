import { describe, it, expect } from 'vitest';
import { generateAriaSnapshotScript } from '../../src/snapshot/aria-snapshot';

describe('aria snapshot script', () => {
  it('returns a string of JavaScript code', () => {
    const script = generateAriaSnapshotScript();
    expect(typeof script).toBe('string');
    expect(script).toContain('data-se-ref');
    expect(script).toContain('INTERACTIVE_TAGS');
  });

  it('script contains walk function', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('function walk');
  });

  it('script assigns eN refs starting from e1', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain("'e' + (++refCounter)");
  });

  it('script handles heading role with level', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('level');
  });

  it('script truncates text to 80 chars', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('slice(0, 80)');
  });

  // --- v0.3: iframe recursive snapshot ---

  it('script contains walkIframe function', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('function walkIframe');
  });

  it('script uses frameCounter for cross-frame refs', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('frameCounter');
  });

  it('script resets frameCounter on each snapshot', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('frameCounter = 0');
  });

  it('script generates cross-frame ref prefix f<index>', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain("'f' + fIdx");
  });

  it('script passes framePrefix to walk function', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('framePrefix');
  });

  it('script saves and restores refCounter across frames', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('savedRefCounter');
    expect(script).toContain('refCounter = 0');
    expect(script).toContain('refCounter = savedRefCounter');
  });

  it('script detects IFRAME tags in walk function', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain("child.tagName === 'IFRAME'");
  });

  it('script accesses contentDocument for same-origin iframes', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('contentDocument');
    expect(script).toContain('contentWindow');
  });

  it('script outputs placeholder for cross-origin iframes', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('cross-origin');
  });

  it('script uses ownerDocument for label resolution', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('el.ownerDocument');
  });

  // --- v0.3: Shadow DOM recursion ---

  it('script traverses open shadow roots', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('el.shadowRoot');
  });

  it('script walks shadowRoot children', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain('el.shadowRoot.children');
  });

  it('script resolves input roles from type (checkbox/radio/button/search/number/range)', () => {
    const script = generateAriaSnapshotScript();
    expect(script).toContain("if (type === 'checkbox') return 'checkbox'");
    expect(script).toContain("if (type === 'radio') return 'radio'");
    expect(script).toContain("if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button'");
    expect(script).toContain("if (type === 'search') return 'searchbox'");
    expect(script).toContain("if (type === 'number') return 'spinbutton'");
    expect(script).toContain("if (type === 'range') return 'slider'");
    expect(script).toContain("return 'textbox'");
  });
});
