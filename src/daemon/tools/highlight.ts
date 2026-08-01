/**
 * v0.7: Element highlight command.
 *
 * Draws a persistent CSS outline around elements to help humans verify
 * which element a ref refers to. Pure JS injection — no BiDi/CDP needed.
 *
 * Usage:
 *   highlight <ref>              — outline element (default: 3px solid red)
 *   highlight <ref> --style="..." — custom CSS outline
 *   highlight <ref> --hide         — remove highlight from element
 *   highlight --hide --all         — remove all highlights
 *   highlight                      — list all highlighted refs
 */

import { Response } from '../../response';
import { findElement } from './shared';
import {
  addHighlight,
  removeHighlight,
  clearAllHighlights,
  getHighlights,
} from './network-state';

const DEFAULT_STYLE = '3px solid red';

export async function browser_highlight(
  driver: any,
  params: {
    target?: string;
    style?: string;
    hide?: boolean;
    all?: boolean;
  },
  response: Response,
): Promise<void> {
  const { target, style, hide, all } = params;

  // highlight --hide --all — remove all highlights
  if (hide && all) {
    clearAllHighlights();
    // Also remove visual highlights from the page
    try {
      await driver.executeScript(`
        document.querySelectorAll('[data-se-highlight]').forEach(el => {
          el.style.outline = '';
          delete el.dataset.seHighlight;
        });
      `);
    } catch {
      // Page may have navigated — highlights already cleared by DOM rebuild
    }
    response.addResult('All highlights cleared');
    response.addCode(`// highlight --hide --all`);
    return;
  }

  // highlight (no args) — list active highlights
  if (!target) {
    const refs = getHighlights();
    if (refs.length === 0) {
      response.addResult('No active highlights');
    } else {
      response.addResult(`Active highlights: ${refs.join(', ')}`);
    }
    response.addCode(`// highlight (list)`);
    return;
  }

  // highlight <ref> --hide — remove highlight from specific element
  if (hide) {
    removeHighlight(target);
    try {
      const el = await findElement(driver, target);
      await driver.executeScript(
        `arguments[0].style.outline = ''; delete arguments[0].dataset.seHighlight;`,
        el,
      );
    } catch {
      // Element may no longer exist — just clear from registry
    }
    response.addResult(`Removed highlight from ${target}`);
    response.addCode(`// highlight ${target} --hide`);
    return;
  }

  // highlight <ref> — apply highlight
  const cssStyle = style || DEFAULT_STYLE;
  const el = await findElement(driver, target);
  await driver.executeScript(
    `arguments[0].style.outline = arguments[1]; arguments[0].dataset.seHighlight = '1';`,
    el, cssStyle,
  );
  addHighlight(target);

  response.addResult(`Highlighted ${target} with outline: ${cssStyle}`);
  response.addCode(
    `const el = await driver.findElement(By.css('[data-se-ref="${target}"]'));\nawait driver.executeScript("arguments[0].style.outline = arguments[1];", el, '${cssStyle}');`
  );
}
