import { Response } from '../../response';

/**
 * v0.13: `preload add|remove|list` — BiDi script preloading.
 *
 * Injects JavaScript that runs before page scripts on every navigation via
 * WebDriver BiDi `script.addPreloadScript` (`driver.script().pin()`), which
 * works on Chromium and Firefox. Preload scripts are per-daemon (like the
 * recorder): they live in the browser session and are lost when the daemon
 * restarts; the registry here keeps the human-readable list for `preload list`
 * and lets `preload remove` clean up even after a driver reset invalidated the
 * BiDi script id.
 */

/** In-memory registry of preload scripts registered in this daemon. */
export const preloadRegistry = new Map<string, { script: string }>();

/**
 * Normalize a user-supplied preload script into a function declaration that
 * WebDriver BiDi can pin. Bare code is wrapped in `function() { ... }`;
 * existing function/arrow declarations pass through unchanged.
 */
export function normalizePreloadScript(script: string): string {
  const trimmed = script.trim();
  if (!trimmed) {
    throw new Error('Error: --script is required and must not be empty');
  }
  if (trimmed.startsWith('(') || trimmed.startsWith('function')) {
    return trimmed;
  }
  return `function() {\n${trimmed}\n}`;
}

/** Resolve the BiDi Script domain for a driver. */
async function scriptDomain(driver: any): Promise<{ pin: Function; unpin: Function }> {
  const script = driver.script();
  if (!script || typeof script.pin !== 'function') {
    throw new Error('Error: preload scripts require WebDriver BiDi — this browser/session does not support it (Safari does not)');
  }
  return script;
}

export async function browser_preload_add(
  driver: any,
  params: { script?: string },
  response: Response,
): Promise<void> {
  const script = params.script;
  if (!script || !script.trim()) {
    throw new Error('Error: --script is required. Usage: se-cli preload add --script="<js>"');
  }
  const declaration = normalizePreloadScript(script);
  const domain = await scriptDomain(driver);
  const id = await domain.pin(declaration);
  preloadRegistry.set(String(id), { script: declaration });
  response.addCode(`const preloadId = await driver.script().pin(${JSON.stringify(declaration)});`);
  response.addResult(`preload script registered: ${id}`);
}

export async function browser_preload_remove(
  driver: any,
  params: { id?: string },
  response: Response,
): Promise<void> {
  const id = params.id;
  if (!id) {
    throw new Error('Error: --id is required. Usage: se-cli preload remove --id=<scriptId>');
  }
  try {
    const domain = await scriptDomain(driver);
    await domain.unpin(id);
  } catch (e: any) {
    // The BiDi id may be stale after a driver reset — still drop the local
    // registry entry and report the situation instead of failing hard.
    response.addResult(`warning: ${e.message} — removed from the local registry (the browser session may have been reset)`);
  }
  const removed = preloadRegistry.delete(id);
  if (!removed) {
    response.addResult(`no local registry entry for preload script ${id}`);
  }
  response.addCode(`await driver.script().unpin('${id}');`);
  if (!response.getError()) {
    response.addResult(`preload script removed: ${id}`);
  }
}

export async function browser_preload_list(
  driver: any,
  _params: Record<string, never>,
  response: Response,
): Promise<void> {
  if (preloadRegistry.size === 0) {
    response.addResult('no preload scripts registered in this session');
    return;
  }
  const lines: string[] = [];
  for (const [id, entry] of preloadRegistry) {
    const snippet = entry.script.length > 60 ? entry.script.slice(0, 57) + '...' : entry.script;
    lines.push(`[${id}] ${snippet}`);
  }
  response.addResult(lines.join('\n'));
}
