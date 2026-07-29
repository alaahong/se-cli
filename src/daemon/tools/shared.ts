import { By } from 'selenium-webdriver';

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
