import { Response } from '../../response';

/**
 * v0.13: `context-new|close|list` — BiDi user contexts (browser containers).
 *
 * WebDriver BiDi `browser.createUserContext` / `removeUserContext` /
 * `getUserContexts` create isolated browsing containers (like Chrome
 * profiles / Firefox containers): cookies, storage and tabs are partitioned
 * per context. Supported by Chromium and Firefox; Safari has no BiDi.
 *
 * The daemon talks to these via raw BiDi commands (the JS binding exposes no
 * browser-domain wrapper yet), the same pattern as `browsingContext.setViewport`.
 */

/** Send a raw BiDi command and return the `result` object (or throw). */
async function bidiCommand(driver: any, method: string, params: Record<string, unknown> = {}) {
  let bidi: any;
  try {
    bidi = await driver.getBidi();
  } catch (e: any) {
    throw new Error(`Error: ${method} requires WebDriver BiDi — this browser/session does not support it (Safari does not): ${e.message}`);
  }
  const payload = await bidi.send({ method, params });
  if (payload && payload.error) {
    throw new Error(`${method}: ${payload.error.message || JSON.stringify(payload.error)}`);
  }
  return payload?.result ?? {};
}

export async function browser_context_new(
  driver: any,
  _params: Record<string, never>,
  response: Response,
): Promise<void> {
  const result = await bidiCommand(driver, 'browser.createUserContext');
  const id = result.userContext as string;
  response.addCode(`const userContext = await driver.getBidi().then(b => b.send({ method: 'browser.createUserContext', params: {} }));`);
  response.addResult(`user context created: ${id}`);
}

export async function browser_context_list(
  driver: any,
  _params: Record<string, never>,
  response: Response,
): Promise<void> {
  const result = await bidiCommand(driver, 'browser.getUserContexts');
  const contexts = (result.userContexts as Array<{ userContext: string }>) ?? [];
  response.addCode(`const contexts = await driver.getBidi().then(b => b.send({ method: 'browser.getUserContexts', params: {} }));`);
  if (contexts.length === 0) {
    response.addResult('no user contexts');
    return;
  }
  const lines = contexts.map((c) => `[${c.userContext}]`);
  response.addResult(lines.join('\n'));
}

export async function browser_context_close(
  driver: any,
  params: { id?: string },
  response: Response,
): Promise<void> {
  const id = params.id;
  if (!id) {
    throw new Error('Error: --id is required. Usage: se-cli context-close --id=<contextId>');
  }
  await bidiCommand(driver, 'browser.removeUserContext', { userContext: id });
  response.addCode(`await driver.getBidi().then(b => b.send({ method: 'browser.removeUserContext', params: { userContext: '${id}' } }));`);
  response.addResult(`user context removed: ${id}`);
}
