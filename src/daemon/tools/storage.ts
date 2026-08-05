import { Response } from '../../response';
import { jsString } from './shared';

// ---------------------------------------------------------------------------
// Cookie management
//
// Uses driver.manage() API (not executeScript) because httpOnly cookies are
// not readable via document.cookie in JavaScript.
// ---------------------------------------------------------------------------

export async function browser_cookie_list(driver: any, _params: any, response: Response): Promise<void> {
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
  params: { name: string; value: string; domain?: string; path?: string; httpOnly?: boolean; secure?: boolean },
  response: Response
): Promise<void> {
  const cookie: Record<string, any> = { name: params.name, value: params.value };
  if (params.domain !== undefined) cookie.domain = params.domain;
  if (params.path !== undefined) cookie.path = params.path;
  if (params.httpOnly !== undefined) cookie.httpOnly = params.httpOnly;
  if (params.secure !== undefined) cookie.secure = params.secure;

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
