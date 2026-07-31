import { Response } from '../../response';
import { findElement, findElementWithWait, byToString, resolveTarget } from './shared';
import type { WaitConfig } from '../../wait-config';

/**
 * AssertionError — thrown when an expect assertion fails.
 * The server catches this and returns { ok: false, code: 'ASSERTION_FAILED' }
 * so the CLI exits with code 1 (CI-friendly).
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * Poll a boolean condition until it matches the expected value or timeout expires.
 * When timeout <= 0, checks once without polling (for --no-wait).
 */
async function pollUntil(
  check: () => Promise<boolean>,
  expected: boolean,
  timeout: number,
  interval = 100,
): Promise<boolean> {
  if (timeout <= 0) {
    try {
      return (await check()) === expected;
    } catch {
      return false;
    }
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await check()) === expected) return true;
    } catch {
      // Stale element or transient error — keep polling
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

/**
 * Poll a string condition until it matches the expected value or timeout expires.
 * Returns the actual string value (for error messages).
 */
async function pollString(
  check: () => Promise<string>,
  timeout: number,
  interval = 100,
): Promise<string> {
  if (timeout <= 0) {
    try {
      return await check();
    } catch {
      return '';
    }
  }
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch {
      // keep polling
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return last;
}

function textMatches(actual: string, expected: string, exact: boolean): boolean {
  if (exact) return actual === expected;
  return actual.includes(expected);
}

/**
 * expect <ref|sel> visible|hidden [--not] [--timeout=N]
 * expect <ref> enabled|disabled|checked|unchecked [--not] [--timeout=N]
 * expect <ref> text "expected" [--exact] [--not] [--timeout=N]
 * expect <ref> value "expected" [--exact] [--not] [--timeout=N]
 * expect <ref> count N [--not] [--timeout=N]
 * expect <ref> attribute <name> <value> [--exact] [--not] [--timeout=N]
 * expect title "..." [--exact] [--not] [--timeout=N]
 * expect url "..." [--exact] [--not] [--timeout=N]
 */
export async function browser_expect(
  driver: any,
  params: {
    target: string;
    assertion: string;
    expected?: string;
    attributeValue?: string;
    not?: boolean;
    exact?: boolean;
    _wait?: WaitConfig;
  },
  response: Response,
): Promise<void> {
  const timeout = params._wait?.timeout ?? 5000;
  const not = params.not ?? false;
  const exact = params.exact ?? false;

  // ── Non-element assertions: title and url ──────────────────
  if (params.target === 'title') {
    const expectedText = params.assertion; // positional[1] is the expected title
    const actual = await pollString(() => driver.getTitle(), timeout);
    const matched = textMatches(actual, expectedText, exact);
    const passed = not ? !matched : matched;
    if (!passed) {
      throw new AssertionError(
        `Expected title to ${not ? 'not ' : ''}${exact ? 'be' : 'contain'} "${expectedText}", but was "${actual}"`
      );
    }
    response.addResult(`✓ title ${not ? 'not ' : ''}${exact ? '==' : '~'} "${expectedText}"`);
    response.addCode(`// expect title "${expectedText}"`);
    return;
  }

  if (params.target === 'url') {
    const expectedUrl = params.assertion;
    const actual = await pollString(() => driver.getCurrentUrl(), timeout);
    const matched = textMatches(actual, expectedUrl, exact);
    const passed = not ? !matched : matched;
    if (!passed) {
      throw new AssertionError(
        `Expected url to ${not ? 'not ' : ''}${exact ? 'be' : 'contain'} "${expectedUrl}", but was "${actual}"`
      );
    }
    response.addResult(`✓ url ${not ? 'not ' : ''}${exact ? '==' : '~'} "${expectedUrl}"`);
    response.addCode(`// expect url "${expectedUrl}"`);
    return;
  }

  // ── Count assertion: expect <selector> count N ─────────────
  if (params.assertion === 'count') {
    const expectedCount = parseInt(params.expected || '0');
    const by = await resolveTarget(params.target);
    const check = async (): Promise<boolean> => {
      const els = await driver.findElements(by);
      return els.length === expectedCount;
    };
    const passed = await pollUntil(check, !not, timeout);
    if (!passed) {
      // Get actual count for error message
      let actualCount = -1;
      try {
        const els = await driver.findElements(by);
        actualCount = els.length;
      } catch {}
      throw new AssertionError(
        `Expected count to ${not ? 'not ' : ''}be ${expectedCount}, but was ${actualCount}`
      );
    }
    response.addResult(`✓ count ${not ? '!= ' : '== '}${expectedCount}`);
    response.addCode(`// expect ${params.target} count ${expectedCount}`);
    return;
  }

  // ── Element-based assertions ──────────────────────────────
  const el = await findElementWithWait(driver, params.target, params._wait);
  const byStr = byToString(params.target);

  switch (params.assertion) {
    case 'visible': {
      const passed = await pollUntil(() => el.isDisplayed(), !not, timeout);
      if (!passed) {
        throw new AssertionError(`Expected element to ${not ? 'not ' : ''}be visible`);
      }
      response.addResult(`✓ ${not ? 'not ' : ''}visible`);
      response.addCode(`await driver.wait(until.elementIs${not ? 'Not' : ''}Visible(${byStr}), ${timeout});`);
      return;
    }
    case 'hidden': {
      // hidden is the inverse of visible
      const passed = await pollUntil(() => el.isDisplayed(), not, timeout);
      if (!passed) {
        throw new AssertionError(`Expected element to ${not ? 'not ' : ''}be hidden`);
      }
      response.addResult(`✓ ${not ? 'not ' : ''}hidden`);
      response.addCode(`await driver.wait(until.elementIs${not ? '' : 'Not'}Visible(${byStr}), ${timeout});`);
      return;
    }
    case 'enabled': {
      const passed = await pollUntil(() => el.isEnabled(), !not, timeout);
      if (!passed) {
        throw new AssertionError(`Expected element to ${not ? 'not ' : ''}be enabled`);
      }
      response.addResult(`✓ ${not ? 'not ' : ''}enabled`);
      response.addCode(`await driver.wait(until.elementIs${not ? 'Not' : ''}Enabled(${byStr}), ${timeout});`);
      return;
    }
    case 'disabled': {
      const passed = await pollUntil(() => el.isEnabled(), not, timeout);
      if (!passed) {
        throw new AssertionError(`Expected element to ${not ? 'not ' : ''}be disabled`);
      }
      response.addResult(`✓ ${not ? 'not ' : ''}disabled`);
      response.addCode(`await driver.wait(until.elementIs${not ? '' : 'Not'}Enabled(${byStr}), ${timeout});`);
      return;
    }
    case 'checked': {
      const passed = await pollUntil(() => el.isSelected(), !not, timeout);
      if (!passed) {
        throw new AssertionError(`Expected element to ${not ? 'not ' : ''}be checked`);
      }
      response.addResult(`✓ ${not ? 'not ' : ''}checked`);
      response.addCode(`await driver.wait(until.elementIs${not ? 'Not' : ''}Selected(${byStr}), ${timeout});`);
      return;
    }
    case 'unchecked': {
      const passed = await pollUntil(() => el.isSelected(), not, timeout);
      if (!passed) {
        throw new AssertionError(`Expected element to ${not ? 'not ' : ''}be unchecked`);
      }
      response.addResult(`✓ ${not ? 'not ' : ''}unchecked`);
      response.addCode(`await driver.wait(until.elementIs${not ? '' : 'Not'}Selected(${byStr}), ${timeout});`);
      return;
    }
    case 'text': {
      const expected = params.expected || '';
      const actual = await pollString(() => el.getText(), timeout);
      const matched = textMatches(actual, expected, exact);
      const passed = not ? !matched : matched;
      if (!passed) {
        throw new AssertionError(
          `Expected text to ${not ? 'not ' : ''}${exact ? 'be' : 'contain'} "${expected}", but was "${actual}"`
        );
      }
      response.addResult(`✓ text ${not ? '!' : ''}${exact ? '==' : '~'} "${expected}"`);
      response.addCode(`// expect text "${expected}" ${exact ? '--exact' : ''}`);
      return;
    }
    case 'value': {
      const expected = params.expected || '';
      const actual = await pollString(() => el.getAttribute('value'), timeout);
      const matched = textMatches(actual, expected, exact);
      const passed = not ? !matched : matched;
      if (!passed) {
        throw new AssertionError(
          `Expected value to ${not ? 'not ' : ''}${exact ? 'be' : 'contain'} "${expected}", but was "${actual}"`
        );
      }
      response.addResult(`✓ value ${not ? '!' : ''}${exact ? '==' : '~'} "${expected}"`);
      response.addCode(`// expect value "${expected}" ${exact ? '--exact' : ''}`);
      return;
    }
    case 'attribute': {
      const name = params.expected || '';
      const expectedVal = params.attributeValue || '';
      const actual = await pollString(() => el.getAttribute(name), timeout);
      const matched = textMatches(actual, expectedVal, exact);
      const passed = not ? !matched : matched;
      if (!passed) {
        throw new AssertionError(
          `Expected attribute "${name}" to ${not ? 'not ' : ''}${exact ? 'be' : 'contain'} "${expectedVal}", but was "${actual}"`
        );
      }
      response.addResult(`✓ attribute ${name} ${not ? '!' : ''}${exact ? '==' : '~'} "${expectedVal}"`);
      response.addCode(`// expect attribute ${name}="${expectedVal}"`);
      return;
    }
    default:
      throw new Error(`Unknown assertion type: ${params.assertion}. ` +
        `Supported: visible, hidden, enabled, disabled, checked, unchecked, text, value, count, attribute, title, url`);
  }
}
