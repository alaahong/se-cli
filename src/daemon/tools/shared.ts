import { By } from 'selenium-webdriver';
import type { WaitConfig } from '../../wait-config';

export function safeFilename(filename: string): string {
  // Reject any path separator (both POSIX and Windows) so behavior is
  // platform-independent. `path.basename` alone treats `\` as a regular
  // character on Linux, which would let Windows-style traversal slip through.
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Invalid filename: path separators are not allowed. Got: ${filename}`);
  }
  return filename;
}

export async function resolveTarget(target: string) {
  // Cross-frame refs (f<index>e<ref>) are handled directly by findElement
  // because they require driver.switchTo().frame(). resolveTarget only
  // resolves regular refs and CSS selectors.
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return By.css(`[data-se-ref="${target}"]`);
  }
  return By.css(target);
}

/**
 * Find an element by ref, CSS selector, or cross-frame ref.
 *
 * Cross-frame refs use the format `f<index>e<ref>` (e.g. `f0e1`).
 * The index refers to the Nth same-origin iframe encountered during
 * the snapshot walk. The function switches to that iframe before
 * searching for the element by `[data-se-ref]`.
 *
 * Regular refs (`e1`) are first searched in the top-level document.
 * If not found, open shadow roots are searched recursively via
 * executeScript, since CSS selectors cannot pierce shadow boundaries.
 */
export async function findElement(driver: any, target: string) {
  // Cross-frame ref: f<index>e<ref>
  const frameRefMatch = target.match(/^f(\d+)e(\d+)$/);
  if (frameRefMatch) {
    const frameIndex = parseInt(frameRefMatch[1]);
    const ref = 'e' + frameRefMatch[2];

    // Find the Nth same-origin iframe — the snapshot script only
    // assigns frame indices to iframes whose contentDocument is
    // accessible (same-origin). We replicate that logic here.
    const iframe = await driver.executeScript(
      `var count = 0;
       var iframes = document.querySelectorAll('iframe');
       for (var i = 0; i < iframes.length; i++) {
         var doc = null;
         try {
           doc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
         } catch(e) {}
         if (doc && doc.body) {
           if (count === arguments[0]) return iframes[i];
           count++;
         }
       }
       return null;`,
      frameIndex,
    );

    if (!iframe) {
      throw new Error(`Frame f${frameIndex} not found (no same-origin iframe at index ${frameIndex})`);
    }

    // Switch into the iframe and find the element by ref.
    await driver.switchTo().frame(iframe);
    return driver.findElement(By.css(`[data-se-ref="${ref}"]`));
  }

  // Regular ref: e<ref>
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    try {
      // Try the top-level document first — most elements live here.
      return await driver.findElement(By.css(`[data-se-ref="${target}"]`));
    } catch {
      // Not in the light DOM — search open shadow roots recursively.
      // CSS selectors cannot pierce shadow boundaries, so we use
      // executeScript to traverse shadowRoot.children manually.
      const el = await driver.executeScript(
        `function findInShadowRoots(root, ref) {
           var selector = '[data-se-ref="' + ref + '"]';
           var el = root.querySelector(selector);
           if (el) return el;
           var all = root.querySelectorAll('*');
           for (var i = 0; i < all.length; i++) {
             if (all[i].shadowRoot) {
               el = all[i].shadowRoot.querySelector(selector);
               if (el) return el;
               var deep = all[i].shadowRoot.querySelectorAll('*');
               for (var j = 0; j < deep.length; j++) {
                 if (deep[j].shadowRoot) {
                   el = deep[j].shadowRoot.querySelector(selector);
                   if (el) return el;
                 }
               }
             }
           }
           return null;
         }
         return findInShadowRoots(document, arguments[0]);`,
        target,
      );
      if (!el) throw new Error(`Element not found: ${target}`);
      return el;
    }
  }

  // Plain CSS selector
  const by = await resolveTarget(target);
  return driver.findElement(by);
}

export function byToString(target: string): string {
  // Cross-frame ref: f<index>e<ref>
  const frameRefMatch = target.match(/^f(\d+)e(\d+)$/);
  if (frameRefMatch) {
    return `// switchTo().frame(${frameRefMatch[1]})\nBy.css('[data-se-ref="e${frameRefMatch[2]}"]')`;
  }

  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return `By.css('[data-se-ref="${target}"]')`;
  }
  return `By.css('${target}')`;
}

/**
 * Find an element, waiting for it to be located if a wait config is provided.
 *
 * First tries findElement directly (fast path for elements already in the DOM,
 * including hidden ones). If that fails, falls back to a manual polling loop
 * that retries findElement until the element appears or the timeout expires.
 *
 * This approach is more robust than until.elementLocated() across browsers,
 * particularly on Firefox where elementLocated may not find hidden elements.
 *
 * For cross-frame refs, the wait is not applied (findElement is called directly).
 */
export async function findElementWithWait(
  driver: any,
  target: string,
  wait?: WaitConfig,
): Promise<any> {
  // If no wait or wait state is 'none' or timeout <= 0, use regular findElement
  if (!wait || wait.state === 'none' || wait.timeout <= 0) {
    return findElement(driver, target);
  }

  // For cross-frame refs, fall back to regular findElement
  // (frame switching + polling doesn't work reliably)
  const frameRefMatch = target.match(/^f(\d+)e(\d+)$/);
  if (frameRefMatch) {
    return findElement(driver, target);
  }

  // Fast path: try to find the element immediately.
  // This works for elements that are already in the DOM (even if hidden
  // via display:none, visibility:hidden, etc.).
  try {
    return await findElement(driver, target);
  } catch {
    // Element not in DOM yet — fall through to polling loop
  }

  // Slow path: poll until the element appears in the DOM.
  // Use a manual loop instead of until.elementLocated() for better
  // cross-browser compatibility (Firefox's geckodriver may not find
  // certain elements via elementLocated).
  const by = await resolveTarget(target);
  const deadline = Date.now() + wait.timeout;
  const interval = 200; // poll every 200ms
  while (Date.now() < deadline) {
    try {
      return await driver.findElement(by);
    } catch {
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  throw new Error(`Element not found after ${wait.timeout}ms: ${target}`);
}
