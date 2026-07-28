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
});
