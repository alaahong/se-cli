import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from '../../src/response';
import { By } from 'selenium-webdriver';
import {
  ROLE_SCRIPT,
  CSS_INFO_SCRIPT,
  COUNT_ROLE_SCRIPT,
  buildCandidates,
  recommendCandidate,
  codegenBy,
  probeRoleLocatorSupport,
  resetRoleLocatorProbe,
  type LocatorCandidate,
} from '../../src/daemon/tools/locator';
import { browser_generate_locator } from '../../src/daemon/tools/generate-locator';
import { parseCommand } from '../../src/daemon/backend';
import { mapToolToCliArgs } from '../../src/mcp-server';

const ROLE_BUTTON = { role: 'button', name: 'Save Draft' };
const CSS_INFO = { id: 'save-btn', classes: ['btn', 'primary'], tag: 'button', nth: 2 };

function makeDriver(opts: any = {}): any {
  const matchMap: Record<string, number> = opts.matchMap ?? {};
  const driver = {
    executeScript: vi.fn(async (script: string, _el?: any) => {
      // Scripts are wrapped at the call site as `return (${ROLE_SCRIPT})(arguments[0]);`
      if (typeof script === 'string' && script.includes(ROLE_SCRIPT)) return opts.roleName !== undefined ? opts.roleName : ROLE_BUTTON;
      if (typeof script === 'string' && script.includes(CSS_INFO_SCRIPT)) return opts.cssInfo !== undefined ? opts.cssInfo : CSS_INFO;
      if (typeof script === 'string' && script.includes(COUNT_ROLE_SCRIPT)) return opts.roleMatchCount !== undefined ? opts.roleMatchCount : 1;
      if (typeof script === 'string' && script.includes("getAttribute('data-se-ref')")) {
        return opts.refAttr;
      }
      return undefined;
    }),
    findElements: vi.fn(async (by: any) => {
      const key = `${by.using}|${JSON.stringify(by.value)}`;
      const n = matchMap[key] ?? opts.matchCount ?? 1;
      return new Array(n).fill({});
    }),
    findElement: vi.fn(async () => ({})),
    _calls: [],
  };
  return driver;
}

function byKey(by: any): string {
  return `${by.using}|${JSON.stringify(by.value)}`;
}

describe('parseCommand: generate-locator', () => {
  it('maps generate-locator with target and flags', () => {
    const r = parseCommand(['generate-locator', 'e7', '--all', '--style=id']);
    expect(r.toolName).toBe('browser_generate_locator');
    expect(r.toolParams).toEqual({ target: 'e7', all: true, style: 'id' });
  });

  it('maps generate-locator without flags', () => {
    const r = parseCommand(['generate-locator', 'e7']);
    expect(r.toolParams).toEqual({ target: 'e7', all: false, style: undefined });
  });

  it('passes --locator-style to interaction commands only when set', () => {
    const r = parseCommand(['click', 'e1', '--locator-style=ref']);
    expect(r.toolParams).toEqual({ target: 'e1', locatorStyle: 'ref' });
    const r2 = parseCommand(['click', 'e1']);
    expect(r2.toolParams).toEqual({ target: 'e1' });
  });

  it('maps generate-locator through MCP', () => {
    expect(mapToolToCliArgs('browser_generate_locator', { target: 'e7' })).toEqual(['generate-locator', 'e7']);
    expect(mapToolToCliArgs('browser_generate_locator', { target: 'e7', all: true, style: 'css' })).toEqual([
      'generate-locator', 'e7', '--all', '--style=css',
    ]);
  });

  it('maps locatorStyle through MCP for click', () => {
    expect(mapToolToCliArgs('browser_click', { target: 'e1' })).toEqual(['click', 'e1']);
    expect(mapToolToCliArgs('browser_click', { target: 'e1', locatorStyle: 'ref' })).toEqual([
      'click', 'e1', '--locator-style=ref',
    ]);
  });
});

describe('buildCandidates', () => {
  it('builds role, id, css and xpath candidates with match counts', async () => {
    const driver = makeDriver({
      matchMap: {
        [byKey(new By('role', { role: 'button', name: 'Save Draft' }))]: 1,
        [byKey(By.id('save-btn'))]: 1,
        [byKey(By.css('#save-btn'))]: 1,
        [byKey(By.css('button.btn'))]: 1,
        [byKey(By.css('button:nth-of-type(2)'))]: 1,
        [byKey(By.xpath(`//button[contains(text(), 'Save Draft')]`))]: 1,
      },
    });
    const candidates = await buildCandidates(driver, {});
    const types = candidates.map((c) => c.type).sort();
    expect(types).toEqual(['css', 'css', 'css', 'id', 'role', 'xpath']);
    const role = candidates.find((c) => c.type === 'role')!;
    expect(role.expression).toBe(`new By('role', { role: 'button', name: 'Save Draft' })`);
    expect(role.matchCount).toBe(1);
    const id = candidates.find((c) => c.type === 'id')!;
    expect(id.expression).toBe(`By.id('save-btn')`);
    const xpath = candidates.find((c) => c.type === 'xpath')!;
    expect(xpath.expression).toContain(`contains(text(), 'Save Draft')`);
  });

  it('omits xpath when the element has no name', async () => {
    const driver = makeDriver({ roleName: { role: 'button', name: '' }, matchCount: 1 });
    const candidates = await buildCandidates(driver, {});
    expect(candidates.some((c) => c.type === 'xpath')).toBe(false);
  });

  it('omits id/css-id when the id is not a stable identifier', async () => {
    const driver = makeDriver({ cssInfo: { id: 'with spaces!', classes: ['btn'], tag: 'button', nth: 1 }, matchCount: 1 });
    const candidates = await buildCandidates(driver, {});
    expect(candidates.some((c) => c.type === 'id')).toBe(false);
    expect(candidates.some((c) => c.type === 'css' && c.expression.includes('#with'))).toBe(false);
  });

  it('counts failed locator queries as zero matches', async () => {
    const driver = makeDriver({
      matchMap: {},
      roleName: { role: 'button', name: 'Save Draft' },
      roleMatchCount: 0,
    });
    driver.findElements = vi.fn(async () => {
      throw new Error('no such element');
    });
    const candidates = await buildCandidates(driver, {});
    for (const c of candidates) expect(c.matchCount).toBe(0);
  });
});

describe('recommendCandidate', () => {
  function candidate(type: LocatorCandidate['type'], matchCount: number, expression: string): LocatorCandidate {
    return {
      type,
      expression,
      by: By.css('x'),
      matchCount,
      stability: { role: 100, id: 90, css: 70, xpath: 50 }[type] ?? 0,
    };
  }

  it('prefers the unique candidate with the highest stability', () => {
    const candidates = [
      candidate('css', 1, 'By.css("button.btn")'),
      candidate('role', 1, 'role-expr'),
      candidate('xpath', 1, 'xpath-expr'),
    ];
    expect(recommendCandidate(candidates)!.expression).toBe('role-expr');
  });

  it('returns null when every candidate is ambiguous', () => {
    const candidates = [candidate('role', 2, 'role-expr'), candidate('css', 3, 'css-expr')];
    expect(recommendCandidate(candidates)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(recommendCandidate([])).toBeNull();
  });
});

describe('codegenBy', () => {
  beforeEach(() => {
    resetRoleLocatorProbe(); // module-level probe cache must not leak between tests
  });

  it('role style: uses role locator when unique', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const out = await codegenBy(driver, {}, 'role', 'e1');
    expect(out.expression).toBe(`new By('role', { role: 'button', name: 'Save Draft' })`);
    expect(out.note).toBeUndefined();
  });

  it('role style: falls back to CSS when the driver rejects role locators', async () => {
    // Regression: real ChromeDriver/geckodriver without the Accessibility
    // extension throw "invalid locator" for new By('role', ...), so the
    // emitted replay code must fall back to CSS instead of emitting code
    // that fails on replay.
    resetRoleLocatorProbe();
    const driver = makeDriver({ matchCount: 1 });
    driver.findElements = vi.fn(async () => {
      throw new Error('invalid locator: role');
    });
    const out = await codegenBy(driver, {}, 'role', 'e1');
    expect(out.expression).toBe(`By.css('#save-btn')`);
    expect(out.note).toContain('driver does not support the role locator strategy; used CSS');
  });

  it('role style: caches the support probe per session', async () => {
    resetRoleLocatorProbe();
    const driver = makeDriver({ matchCount: 1 });
    await codegenBy(driver, {}, 'role', 'e1'); // first call probes
    await codegenBy(driver, {}, 'role', 'e1'); // second call uses cache
    const probeCalls = driver.findElements.mock.calls.filter(
      (c: any[]) => c[0]?.using === 'role',
    ).length;
    expect(probeCalls).toBe(1);
  });

  it('role style: falls back to CSS with a note when ambiguous', async () => {
    const driver = makeDriver({ matchCount: 2, roleMatchCount: 2 });
    const out = await codegenBy(driver, {}, 'role', 'e1');
    expect(out.expression).toBe(`By.css('#save-btn')`);
    expect(out.note).toContain('role locator was ambiguous (2 matches); fell back to CSS');
  });

  it('role style: falls back to CSS when the element has no role', async () => {
    const driver = makeDriver({ roleName: null, matchCount: 1 });
    const out = await codegenBy(driver, {}, 'role', 'e1');
    expect(out.expression).toBe(`By.css('#save-btn')`);
    expect(out.note).toContain('no discernible role+name');
  });

  it('css style: prefers a unique CSS selector', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const out = await codegenBy(driver, {}, 'css', 'e1');
    expect(out.expression).toBe(`By.css('#save-btn')`);
  });

  it('ref style: uses the data-se-ref of the target directly', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const out = await codegenBy(driver, {}, 'ref', 'e5');
    expect(out.expression).toBe(`By.css('[data-se-ref="e5"]')`);
  });

  it('ref style: reads the ref attribute when target is a selector', async () => {
    const driver = makeDriver({ matchCount: 1, refAttr: 'e9' });
    const out = await codegenBy(driver, {}, 'ref', 'button.btn');
    expect(out.expression).toBe(`By.css('[data-se-ref="e9"]')`);
  });

  it('ref style: falls back to CSS when the element has no ref', async () => {
    const driver = makeDriver({ matchCount: 1, refAttr: null });
    const out = await codegenBy(driver, {}, 'ref', 'button.btn');
    expect(out.expression).toBe(`By.css('#save-btn')`);
  });

  it('returns a fallback expression when no candidates exist', async () => {
    const driver = makeDriver({ roleName: null, cssInfo: { id: '', classes: [], tag: 'div', nth: 0 }, matchCount: 1 });
    const out = await codegenBy(driver, {}, 'role', 'e1');
    expect(out.expression).toBe(`By.css('*')`);
    expect(out.note).toContain('no stable locator');
  });
});

describe('browser_generate_locator', () => {
  it('text mode: prints recommended and alternatives', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, { target: 'e7' }, response);
    const out = response.serialize();
    expect(out).toContain('Recommended:');
    expect(out).toContain(`new By('role', { role: 'button', name: 'Save Draft' })`);
    expect(out).toContain('Alternatives:');
  });

  it('--all: lists every candidate with match counts', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, { target: 'e7', all: true }, response);
    const out = response.serialize();
    expect(out).toContain('Locator candidates for e7:');
    expect(out).toContain('(role *)');
    expect(out).toContain('1 match');
  });

  it('--raw: outputs only the recommended expression', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: true, json: false });
    await browser_generate_locator(driver, { target: 'e7' }, response);
    expect(response.serialize()).toBe(`new By('role', { role: 'button', name: 'Save Draft' })`);
  });

  it('--raw: reports when no unique locator exists', async () => {
    const driver = makeDriver({ matchCount: 3, roleMatchCount: 3 });
    const response = new Response({ raw: true, json: false });
    await browser_generate_locator(driver, { target: 'e7' }, response);
    expect(response.serialize()).toContain('no unique locator found');
  });

  it('--json: emits structured rows with recommended flag', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: true });
    await browser_generate_locator(driver, { target: 'e7' }, response);
    const rows = JSON.parse(JSON.parse(response.serialize()).result);
    expect(Array.isArray(rows)).toBe(true);
    const rec = rows.find((r: any) => r.recommended);
    expect(rec.type).toBe('role');
    expect(rec.matchCount).toBe(1);
    expect(rows.every((r: any) => typeof r.locator === 'string' && typeof r.matchCount === 'number')).toBe(true);
  });

  it('--style forces a single locator type', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, { target: 'e7', style: 'id' }, response);
    const out = response.serialize();
    expect(out).toContain(`By.id('save-btn')`);
    expect(out).not.toContain('new By(');
  });

  it('--style with an unsupported type reports an error', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, { target: 'e7', style: 'nope' }, response);
    expect(response.serialize()).toContain('### Error');
  });

  it('requires a target', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, {}, response);
    expect(response.serialize()).toContain('generate-locator requires a ref');
  });

  it('reports findElement failures without throwing', async () => {
    const driver = makeDriver({ matchCount: 1 });
    driver.findElement = vi.fn(async () => {
      throw new Error('element gone');
    });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, { target: 'e7' }, response);
    expect(response.serialize()).toContain('generate-locator failed:');
  });

  it('emits no Selenium code section', async () => {
    const driver = makeDriver({ matchCount: 1 });
    const response = new Response({ raw: false, json: false });
    await browser_generate_locator(driver, { target: 'e7' }, response);
    expect(response.serialize()).not.toContain('### Ran Selenium code');
  });
});
