import { Response } from '../../response';
import { jsString } from './shared';

// ---------------------------------------------------------------------------
// Cookie management
//
// Default: driver.manage() API (not executeScript) because httpOnly cookies
// are not readable via document.cookie in JavaScript.
// With --bidi: WebDriver BiDi storage.getCookies/setCookie, which supports
// partition keys (user-context-scoped cookies, v0.13). Chromium + Firefox.
// ---------------------------------------------------------------------------

/** Build the BiDi storageKey partition for a user context (or default). */
function bidiPartition(userContext?: string): Record<string, string> {
  const partition: Record<string, string> = { type: 'storageKey' };
  if (userContext !== undefined && userContext !== '') partition.userContext = userContext;
  return partition;
}

async function bidiStorage(driver: any) {
  try {
    return await driver.getBidi();
  } catch (e: any) {
    throw new Error(`Error: cookie --bidi requires WebDriver BiDi — this browser/session does not support it (Safari does not): ${e.message}`);
  }
}

export async function browser_cookie_list(
  driver: any,
  params: { bidi?: boolean; userContext?: string },
  response: Response,
): Promise<void> {
  if (params.bidi) {
    const bidi = await bidiStorage(driver);
    const partition = bidiPartition(params.userContext);
    const payload = await bidi.send({ method: 'storage.getCookies', params: { partition } });
    if (payload && payload.error) {
      throw new Error(`storage.getCookies: ${payload.error.message || JSON.stringify(payload.error)}`);
    }
    const cookies = payload?.result?.cookies ?? [];
    response.addCode(`const { cookies } = await driver.getBidi().then(b => b.send({ method: 'storage.getCookies', params: { partition: ${JSON.stringify(partition)} } }));`);
    response.addResult(JSON.stringify(cookies, null, 2));
    return;
  }
  const cookies = await driver.manage().getCookies();
  response.addCode(`const cookies = await driver.manage().getCookies();`);
  response.addResult(JSON.stringify(cookies, null, 2));
}

export async function browser_cookie_get(
  driver: any,
  params: { name: string },
  response: Response
): Promise<void> {
  const cookie = await driver.manage().getCookie(params.name);
  response.addCode(`const cookie = await driver.manage().getCookie(${jsString(params.name)});`);
  response.addResult(JSON.stringify(cookie, null, 2));
}

export async function browser_cookie_set(
  driver: any,
  params: { name: string; value: string; domain?: string; path?: string; httpOnly?: boolean; secure?: boolean; bidi?: boolean; userContext?: string },
  response: Response
): Promise<void> {
  const cookie: Record<string, any> = { name: params.name, value: params.value };
  if (params.domain !== undefined) cookie.domain = params.domain;
  if (params.path !== undefined) cookie.path = params.path;
  if (params.httpOnly !== undefined) cookie.httpOnly = params.httpOnly;
  if (params.secure !== undefined) cookie.secure = params.secure;

  if (params.bidi) {
    const bidi = await bidiStorage(driver);
    const partition = bidiPartition(params.userContext);
    const payload = await bidi.send({
      method: 'storage.setCookie',
      params: { cookie, partition },
    });
    if (payload && payload.error) {
      throw new Error(`storage.setCookie: ${payload.error.message || JSON.stringify(payload.error)}`);
    }
    response.addCode(`await driver.getBidi().then(b => b.send({ method: 'storage.setCookie', params: { cookie: ${JSON.stringify(cookie)}, partition: ${JSON.stringify(partition)} } }));`);
    response.addResult(`cookie set: ${params.name}=${params.value}${params.userContext ? ` (user context: ${params.userContext})` : ''}`);
    return;
  }

  await driver.manage().addCookie(cookie);

  const parts: string[] = [`name: ${jsString(params.name)}`, `value: ${jsString(params.value)}`];
  if (params.domain !== undefined) parts.push(`domain: ${jsString(params.domain)}`);
  if (params.path !== undefined) parts.push(`path: ${jsString(params.path)}`);
  if (params.httpOnly !== undefined) parts.push(`httpOnly: ${params.httpOnly}`);
  if (params.secure !== undefined) parts.push(`secure: ${params.secure}`);
  response.addCode(`await driver.manage().addCookie({ ${parts.join(', ')} });`);
  response.addResult(`cookie set: ${params.name}=${params.value}`);
}

export async function browser_cookie_delete(
  driver: any,
  params: { name?: string },
  response: Response
): Promise<void> {
  if (params.name) {
    await driver.manage().deleteCookie(params.name);
    response.addCode(`await driver.manage().deleteCookie(${jsString(params.name)});`);
    response.addResult(`deleted cookie: ${params.name}`);
  } else {
    await driver.manage().deleteAllCookies();
    response.addCode(`await driver.manage().deleteAllCookies();`);
    response.addResult('deleted all cookies');
  }
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

export async function browser_localstorage_get(
  driver: any,
  params: { key: string },
  response: Response
): Promise<void> {
  const value = await driver.executeScript('return localStorage.getItem(arguments[0]);', params.key);
  response.addCode(`const value = await driver.executeScript('return localStorage.getItem(arguments[0]);', ${jsString(params.key)});`);
  response.addResult(value === null ? 'null' : String(value));
}

export async function browser_localstorage_set(
  driver: any,
  params: { key: string; value: string },
  response: Response
): Promise<void> {
  await driver.executeScript('localStorage.setItem(arguments[0], arguments[1]);', params.key, params.value);
  response.addCode(`await driver.executeScript('localStorage.setItem(arguments[0], arguments[1]);', ${jsString(params.key)}, ${jsString(params.value)});`);
  response.addResult(`localStorage set: ${params.key}=${params.value}`);
}

export async function browser_localstorage_delete(
  driver: any,
  params: { key?: string },
  response: Response
): Promise<void> {
  if (params.key) {
    await driver.executeScript('localStorage.removeItem(arguments[0]);', params.key);
    response.addCode(`await driver.executeScript('localStorage.removeItem(arguments[0]);', ${jsString(params.key)});`);
    response.addResult(`deleted localStorage key: ${params.key}`);
  } else {
    await driver.executeScript('localStorage.clear();');
    response.addCode(`await driver.executeScript('localStorage.clear();');`);
    response.addResult('cleared all localStorage');
  }
}

export async function browser_localstorage_list(driver: any, _params: any, response: Response): Promise<void> {
  const script = 'return (() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })();';
  const items = await driver.executeScript(script);
  response.addCode(`const items = await driver.executeScript('return (() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })();');`);
  response.addResult(JSON.stringify(items, null, 2));
}

// ---------------------------------------------------------------------------
// sessionStorage — same API as localStorage
// ---------------------------------------------------------------------------

export async function browser_sessionstorage_get(
  driver: any,
  params: { key: string },
  response: Response
): Promise<void> {
  const value = await driver.executeScript('return sessionStorage.getItem(arguments[0]);', params.key);
  response.addCode(`const value = await driver.executeScript('return sessionStorage.getItem(arguments[0]);', ${jsString(params.key)});`);
  response.addResult(value === null ? 'null' : String(value));
}

export async function browser_sessionstorage_set(
  driver: any,
  params: { key: string; value: string },
  response: Response
): Promise<void> {
  await driver.executeScript('sessionStorage.setItem(arguments[0], arguments[1]);', params.key, params.value);
  response.addCode(`await driver.executeScript('sessionStorage.setItem(arguments[0], arguments[1]);', ${jsString(params.key)}, ${jsString(params.value)});`);
  response.addResult(`sessionStorage set: ${params.key}=${params.value}`);
}

export async function browser_sessionstorage_delete(
  driver: any,
  params: { key?: string },
  response: Response
): Promise<void> {
  if (params.key) {
    await driver.executeScript('sessionStorage.removeItem(arguments[0]);', params.key);
    response.addCode(`await driver.executeScript('sessionStorage.removeItem(arguments[0]);', ${jsString(params.key)});`);
    response.addResult(`deleted sessionStorage key: ${params.key}`);
  } else {
    await driver.executeScript('sessionStorage.clear();');
    response.addCode(`await driver.executeScript('sessionStorage.clear();');`);
    response.addResult('cleared all sessionStorage');
  }
}

export async function browser_sessionstorage_list(driver: any, _params: any, response: Response): Promise<void> {
  const script = 'return (() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return o; })();';
  const items = await driver.executeScript(script);
  response.addCode(`const items = await driver.executeScript('return (() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return o; })();');`);
  response.addResult(JSON.stringify(items, null, 2));
}
