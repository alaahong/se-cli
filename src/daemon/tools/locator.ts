// NOTE: loaded via require() (not import) so unit tests that vi.mock()
// selenium-webdriver keep the REAL By class here — see the comment in
// tests/unit/coverage-tools.test.ts. We need the real constructor for
// `new By('role', {...})`, the W3C accessibility-attributes locator.
const { By } = require('selenium-webdriver') as typeof import('selenium-webdriver');

// ── Locator heuristics for generate-locator + role-based codegen ───────────
//
// Selenium's JS binding (4.46) has no `By.role()` helper, but the WebDriver
// protocol supports the W3C "accessibility attributes" strategy, so both the
// daemon (match counting) and the emitted user code use the raw form:
//
//   new By('role', { role: 'button', name: 'Save Draft' })
//
// which works in Chrome, Edge, and Firefox.

// NOTE: these scripts are sent to driver.executeScript() as strings, where
// selenium-webdriver executes the string verbatim as a script BODY (only
// Function objects get wrapped in `return (...).apply(null, arguments)`).
// The body must therefore be an expression — a bare `function(el) {...}`
// statement throws "Function statements require a function name". We keep the
// body as an IIFE expression and invoke it at the call site with arguments[0].
export const ROLE_SCRIPT = `(function(el) {
  var tag = el.tagName.toLowerCase();
  var role = el.getAttribute('role');
  if (!role) {
    if (tag === 'button') role = 'button';
    else if (tag === 'a' && el.hasAttribute('href')) role = 'link';
    else if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') role = 'checkbox';
      else if (type === 'radio') role = 'radio';
      else if (type === 'button' || type === 'submit' || type === 'reset') role = 'button';
      else role = 'textbox';
    }
    else if (tag === 'textarea') role = 'textbox';
    else if (tag === 'select') role = 'combobox';
    else if (tag === 'img' && el.hasAttribute('alt')) role = 'img';
    else if (tag === 'nav') role = 'navigation';
    else if (tag === 'form') role = 'form';
    else if (tag === 'table') role = 'table';
    else if (tag === 'ul' || tag === 'ol') role = 'list';
    else if (tag === 'li') role = 'listitem';
    else if (/^h[1-6]$/.test(tag)) role = 'heading';
  }
  if (!role) return null;
  var name = '';
  var ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) name = ariaLabel.trim();
  else {
    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var ids = labelledby.split(/\\s+/);
      var parts = [];
      for (var i = 0; i < ids.length; i++) {
        var lbl = document.getElementById(ids[i]);
        if (lbl) parts.push(lbl.textContent);
      }
      name = parts.join(' ').trim();
    }
  }
  if (!name && el.id) {
    var label = document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
    if (label) name = label.textContent.trim();
  }
  if (!name) {
    var closestLabel = el.closest('label');
    if (closestLabel) name = closestLabel.textContent.trim();
  }
  if (!name && (tag === 'a' || tag === 'button' || tag === 'heading' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6')) {
    name = (el.textContent || '').trim();
  }
  return { role: role, name: name.slice(0, 200) };
})`;

export const CSS_INFO_SCRIPT = `(function(el) {
  var out = { id: el.id || '', classes: [], tag: el.tagName.toLowerCase(), nth: 0 };
  var cls = el.className;
  if (typeof cls === 'string') out.classes = cls.split(/\\s+/).filter(Boolean);
  var parent = el.parentNode;
  if (parent) {
    var kids = parent.children;
    var count = 0;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === el.tagName) { count++; if (kids[i] === el) out.nth = count; }
    }
  }
  return out;
})`;

export interface LocatorCandidate {
  type: 'role' | 'id' | 'css' | 'xpath';
  expression: string;
  by: any;
  matchCount: number;
  stability: number;
  hasName?: boolean;
}

const BASE_STABILITY: Record<string, number> = { role: 100, id: 90, css: 70, xpath: 50 };

function stabilityOf(type: string, expression: string): number {
  let score = BASE_STABILITY[type] ?? 0;
  // Penalize locators built from runtime-injected attributes (the snapshot
  // script adds data-se-ref; frameworks add data-testid/aria-* classes).
  if (/data-se-ref|data-testid|data-cy|aria-[a-z-]+/.test(expression)) score -= 30;
  // Positional selectors break on reflow — slightly less stable.
  if (/:nth-of-type|:nth-child/.test(expression)) score -= 10;
  return score;
}

function jsString(value: string): string {
  // Single-quoted JS string literal, escaping backslashes and quotes.
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Collect locator candidates for an element and compute each one's match
 * count by running `driver.findElements()` on the live page.
 */
export async function buildCandidates(driver: any, el: any): Promise<LocatorCandidate[]> {
  const candidates: LocatorCandidate[] = [];

  const roleName = (await driver.executeScript(`return (${ROLE_SCRIPT})(arguments[0]);`, el)) || null;
  if (roleName && roleName.role) {
    const hasName = !!roleName.name;
    const by =
      hasName
        ? new By('role', { role: roleName.role, name: roleName.name })
        : new By('role', { role: roleName.role });
    const expr =
      hasName
        ? `new By('role', { role: ${jsString(roleName.role)}, name: ${jsString(roleName.name)} })`
        : `new By('role', { role: ${jsString(roleName.role)} })`;
    const matchCount = await countMatches(driver, by);
    candidates.push({
      type: 'role',
      expression: expr,
      by,
      matchCount,
      stability: stabilityOf('role', expr),
      hasName,
    });
  }

  const info = (await driver.executeScript(`return (${CSS_INFO_SCRIPT})(arguments[0]);`, el)) || {};
  const tag = typeof info.tag === 'string' ? info.tag : 'div';
  const id = typeof info.id === 'string' && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(info.id) ? info.id : '';
  const classes: string[] = Array.isArray(info.classes)
    ? info.classes.filter((c: string) => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(c))
    : [];

  if (id) {
    const by = By.id(id);
    const expr = `By.id(${jsString(id)})`;
    candidates.push({
      type: 'id',
      expression: expr,
      by,
      matchCount: await countMatches(driver, by),
      stability: stabilityOf('id', expr),
    });
    const cssBy = By.css(`#${id}`);
    const cssExpr = `By.css('#${id}')`;
    candidates.push({
      type: 'css',
      expression: cssExpr,
      by: cssBy,
      matchCount: await countMatches(driver, cssBy),
      stability: stabilityOf('css', cssExpr),
    });
  }

  if (classes.length > 0) {
    const cssBy = By.css(`${tag}.${classes[0]}`);
    const cssExpr = `By.css('${tag}.${classes[0]}')`;
    candidates.push({
      type: 'css',
      expression: cssExpr,
      by: cssBy,
      matchCount: await countMatches(driver, cssBy),
      stability: stabilityOf('css', cssExpr),
    });
  }

  if (typeof info.nth === 'number' && info.nth > 0) {
    const cssBy = By.css(`${tag}:nth-of-type(${info.nth})`);
    const cssExpr = `By.css('${tag}:nth-of-type(${info.nth})')`;
    candidates.push({
      type: 'css',
      expression: cssExpr,
      by: cssBy,
      matchCount: await countMatches(driver, cssBy),
      stability: stabilityOf('css', cssExpr),
    });
  }

  if (roleName && roleName.name && roleName.name.length < 100) {
    const xpath = `//${tag}[contains(text(), ${jsString(roleName.name)})]`;
    const by = By.xpath(xpath);
    const expr = `By.xpath(${JSON.stringify(xpath)})`;
    candidates.push({
      type: 'xpath',
      expression: expr,
      by,
      matchCount: await countMatches(driver, by),
      stability: stabilityOf('xpath', expr),
    });
  }

  return candidates;
}

async function countMatches(driver: any, by: any): Promise<number> {
  try {
    const els = await driver.findElements(by);
    return Array.isArray(els) ? els.length : 0;
  } catch {
    return 0;
  }
}

/**
 * The recommended locator: a candidate with match count 1 and the highest
 * stability score (role > id > css > xpath). Returns null when no candidate
 * uniquely identifies the element.
 */
export function recommendCandidate(candidates: LocatorCandidate[]): LocatorCandidate | null {
  const unique = candidates.filter((c) => c.matchCount === 1);
  if (unique.length === 0) return null;
  return unique.sort((a, b) => b.stability - a.stability)[0];
}

function uniqueCss(candidates: LocatorCandidate[]): LocatorCandidate | null {
  const css = candidates.filter((c) => c.type === 'css' && c.matchCount === 1);
  return css.length > 0 ? css.sort((a, b) => b.stability - a.stability)[0] : null;
}

/**
 * Produce the codegen By-expression for an element.
 *
 * style:
 *  - 'role' (default): By.role-style locator when unique; falls back to a
 *    stable CSS selector with an explanatory comment when ambiguous or when
 *    the element has no discernible role+name
 *  - 'css': prefer a unique CSS selector (#id > tag.class > tag:nth-of-type)
 *  - 'ref': the MVP behavior — By.css('[data-se-ref="e<N>"]') when the
 *    element carries a ref, else a synthesized CSS selector
 */
export async function codegenBy(
  driver: any,
  el: any,
  style: string,
  target?: string
): Promise<{ expression: string; note?: string }> {
  if (style === 'ref' && target && /^e\d+$/.test(target)) {
    return { expression: `By.css('[data-se-ref="${target}"]')` };
  }

  const candidates = await buildCandidates(driver, el);

  if (style === 'ref') {
    try {
      const ref = await driver.executeScript(
        `var el = arguments[0]; return el.getAttribute('data-se-ref');`,
        el
      );
      if (ref && /^e\d+$/.test(ref)) {
        return { expression: `By.css('[data-se-ref="${ref}"]')` };
      }
    } catch {
      // Fall through to synthesized CSS.
    }
    const css = uniqueCss(candidates);
    if (css) return { expression: css.expression };
    const fallback = candidates.find((c) => c.type === 'css');
    if (fallback) return { expression: fallback.expression };
    return { expression: "By.css('*')", note: 'element has no stable locator' };
  }

  if (style === 'role') {
    const roleCand = candidates.find((c) => c.type === 'role');
    if (roleCand && roleCand.hasName && roleCand.matchCount === 1) {
      return { expression: roleCand.expression };
    }
    const css = uniqueCss(candidates);
    if (roleCand && roleCand.matchCount > 1) {
      const fallback = css ?? candidates.find((c) => c.type === 'css');
      if (fallback) {
        return {
          expression: fallback.expression,
          note: `role locator was ambiguous (${roleCand.matchCount} matches); fell back to CSS`,
        };
      }
    }
    if (css) {
      return { expression: css.expression, note: 'element has no discernible role+name; used CSS' };
    }
    const fallback = candidates.find((c) => c.type === 'css');
    if (fallback) return { expression: fallback.expression };
    return { expression: "By.css('*')", note: 'element has no stable locator' };
  }

  // style === 'css'
  const css = uniqueCss(candidates);
  if (css) return { expression: css.expression };
  const fallback = candidates.find((c) => c.type === 'css');
  if (fallback) return { expression: fallback.expression, note: 'no unique CSS selector; used best match' };
  return { expression: "By.css('*')", note: 'element has no stable locator' };
}
