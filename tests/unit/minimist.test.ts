import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/minimist';

describe('parseArgs', () => {
  it('parses positional args', () => {
    const result = parseArgs(['click', 'e1'], { boolean: [], string: [], alias: {} });
    expect(result._).toEqual(['click', 'e1']);
  });

  it('parses --flag boolean', () => {
    const result = parseArgs(['--headed', 'open'], { boolean: ['headed'], string: [], alias: {} });
    expect(result.headed).toBe(true);
    expect(result._).toEqual(['open']);
  });

  it('parses --key=value', () => {
    const result = parseArgs(['--browser=firefox', 'open'], { boolean: [], string: ['browser'], alias: {} });
    expect(result.browser).toBe('firefox');
  });

  it('parses -s=name alias', () => {
    const result = parseArgs(['-s=mysession', 'open'], { boolean: [], string: [], alias: { s: 'session' } });
    expect(result.session).toBe('mysession');
  });

  it('parses --filename path', () => {
    const result = parseArgs(['--filename=todo.png', 'screenshot'], { boolean: [], string: ['filename'], alias: {} });
    expect(result.filename).toBe('todo.png');
  });
});
