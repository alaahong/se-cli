import { Response } from '../../response';

// ── Ref assignment for returned elements ────────────────────────────────────
//
// Elements returned by run-code snippets are made usable by subsequent
// commands (click e100, fill e101, ...) the same way the aria snapshot does:
// a `data-se-ref="e<N>"` attribute is written onto the element in the page,
// and the CLI returns the ref string. Ref numbering continues from the
// highest existing `e<N>` in the document so newly assigned refs never
// collide with snapshot refs.

export async function nextRefNumber(driver: any): Promise<number> {
  const max = await driver.executeScript(
    `var max = 0;
     var els = document.querySelectorAll('[data-se-ref]');
     for (var i = 0; i < els.length; i++) {
       var m = els[i].getAttribute('data-se-ref').match(/^e(\\d+)$/);
       if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
     }
     return max;`
  );
  return typeof max === 'number' && isFinite(max) ? max : 0;
}

export function isWebElement(value: any): boolean {
  const { WebElement } = require('selenium-webdriver');
  if (value instanceof WebElement) return true;
  // Duck-typing fallback: WebElement instances expose getId() and the
  // driver command API; this also lets unit tests pass fake elements.
  return !!(
    value &&
    typeof value === 'object' &&
    typeof value.getId === 'function' &&
    typeof value.click === 'function'
  );
}

async function registerRef(driver: any, el: any, counter: { n: number }): Promise<string> {
  const ref = `e${++counter.n}`;
  await driver.executeScript(
    'arguments[0].setAttribute("data-se-ref", arguments[1]);',
    el,
    ref
  );
  return ref;
}

/**
 * Recursively serialize a run-code return value:
 * - primitives (string/number/boolean/null) are returned as-is
 * - WebElements are assigned a ref and serialized as `e<N>`
 * - arrays and plain objects are serialized recursively
 * - anything else (bigint, Date, ...) is stringified
 */
export async function serializeValue(
  driver: any,
  value: any,
  counter: { n: number },
  seen: Set<any> = new Set()
): Promise<any> {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (isWebElement(value)) return registerRef(driver, value, counter);
  if (t === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    const out: any[] = [];
    for (const item of value) out.push(await serializeValue(driver, item, counter, seen));
    return out;
  }
  if (t === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = await serializeValue(driver, value[key], counter, seen);
    }
    return out;
  }
  return String(value);
}

/**
 * run-code "<snippet>"
 *
 * Executes an arbitrary Selenium snippet inside the daemon process. The
 * snippet is the BODY of an async function that receives `driver`
 * (the live selenium-webdriver instance):
 *
 *   se-cli run-code "async driver => { return await driver.getTitle(); }"
 *
 * The result is awaited and serialized; returned WebElements get fresh
 * refs (e<N>) so subsequent commands can act on them.
 *
 * SECURITY: the snippet runs with full driver privileges — it can navigate,
 * click, read credentials, and execute JavaScript. Agents should prefer
 * dedicated commands (click/fill/...) whenever possible.
 */
export async function browser_run_code(
  driver: any,
  params: { code?: string },
  response: Response
): Promise<void> {
  const code = (params.code || '').trim();
  if (!code) {
    response.addError(
      'RUN_CODE_ERROR: no code provided. Usage: run-code "async driver => { ... }"'
    );
    return;
  }
  try {
    const fn = new Function('driver', `return (async () => {\n${code}\n})();`);
    const result = await fn(driver);
    const counter = { n: await nextRefNumber(driver) };
    const serialized = await serializeValue(driver, result, counter);
    const resultStr =
      typeof serialized === 'string' ? serialized : JSON.stringify(serialized, null, 2);
    response.addResult(resultStr);
  } catch (e: any) {
    response.addError(`RUN_CODE_ERROR: ${(e && e.message) || String(e)}`);
  }
}
