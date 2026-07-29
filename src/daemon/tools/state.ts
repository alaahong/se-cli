import { Response } from '../../response';
import * as fs from 'fs';
import * as path from 'path';
import { safeFilename } from './shared';

interface BrowserState {
  url: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  savedAt: string;
}

export async function browser_state_save(
  driver: any,
  params: { filename?: string },
  response: Response
): Promise<void> {
  // 1. Collect cookies via the manage() API (httpOnly cookies are invisible to JS).
  const cookies = await driver.manage().getCookies();

  // 2. Collect localStorage.
  const lsScript = 'return (() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })();';
  const localStorageData = await driver.executeScript(lsScript);

  // 3. Collect sessionStorage.
  const ssScript = 'return (() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return o; })();';
  const sessionStorageData = await driver.executeScript(ssScript);

  // 4. Capture the current URL so load() can navigate here first (cookies require
  //    the driver to be on a matching domain).
  const url = await driver.getCurrentUrl();

  // 5. Assemble the state object.
  const state: BrowserState = {
    url,
    cookies,
    localStorage: localStorageData || {},
    sessionStorage: sessionStorageData || {},
    savedAt: new Date().toISOString(),
  };

  // 6. Write to .se-cli/<filename> (same I/O pattern as screenshot.ts).
  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `state-${Date.now()}.json`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, JSON.stringify(state, null, 2));

  response.addCode(`const cookies = await driver.manage().getCookies();\nconst localStorageData = await driver.executeScript('return (() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })();');\nconst sessionStorageData = await driver.executeScript('return (() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return o; })();');\nconst url = await driver.getCurrentUrl();\nfs.writeFileSync('${filename}', JSON.stringify({ url, cookies, localStorage: localStorageData, sessionStorage: sessionStorageData, savedAt: new Date().toISOString() }, null, 2));`);
  response.addResult(`[State](.se-cli/${filename}) (${cookies.length} cookies, ${Object.keys(state.localStorage).length} localStorage items, ${Object.keys(state.sessionStorage).length} sessionStorage items)`);
}

export async function browser_state_load(
  driver: any,
  params: { filename?: string },
  response: Response
): Promise<void> {
  // 1. Resolve the file path.
  const outDir = path.join(process.cwd(), '.se-cli');

  let filename: string | undefined;
  if (params.filename) {
    filename = safeFilename(params.filename);
  } else {
    // Pick the most recent state-*.json file when no filename is given.
    if (!fs.existsSync(outDir)) {
      response.addError('No state file specified and .se-cli/ directory does not exist');
      return;
    }
    const files = fs.readdirSync(outDir)
      .filter(f => f.startsWith('state-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) {
      response.addError('No state file specified and no state-*.json files found in .se-cli/');
      return;
    }
    filename = files[0];
  }

  const file = path.join(outDir, filename);
  if (!fs.existsSync(file)) {
    response.addError(`State file not found: ${file}`);
    return;
  }

  // 2. Read and parse the JSON.
  const raw = fs.readFileSync(file, 'utf8');
  let state: BrowserState;
  try {
    state = JSON.parse(raw);
  } catch (e: any) {
    response.addError(`Failed to parse state file: ${e.message}`);
    return;
  }

  // 3. Navigate to the saved URL first — cookies can only be set when the
  //    driver is on a matching domain.
  await driver.get(state.url);

  // 4. Clear existing cookies before restoring.
  await driver.manage().deleteAllCookies();

  // 5. Restore cookies.
  for (const cookie of state.cookies) {
    await driver.manage().addCookie(cookie);
  }

  // 6. Restore localStorage.
  const lsKeys = Object.keys(state.localStorage);
  for (const k of lsKeys) {
    await driver.executeScript('localStorage.setItem(arguments[0], arguments[1]);', k, state.localStorage[k]);
  }

  // 7. Restore sessionStorage.
  const ssKeys = Object.keys(state.sessionStorage);
  for (const k of ssKeys) {
    await driver.executeScript('sessionStorage.setItem(arguments[0], arguments[1]);', k, state.sessionStorage[k]);
  }

  response.addCode(`const state = JSON.parse(fs.readFileSync('${filename}', 'utf8'));\nawait driver.get(state.url);\nawait driver.manage().deleteAllCookies();\nfor (const cookie of state.cookies) { await driver.manage().addCookie(cookie); }\nfor (const k of Object.keys(state.localStorage)) { await driver.executeScript('localStorage.setItem(arguments[0], arguments[1]);', k, state.localStorage[k]); }\nfor (const k of Object.keys(state.sessionStorage)) { await driver.executeScript('sessionStorage.setItem(arguments[0], arguments[1]);', k, state.sessionStorage[k]); }`);
  response.addResult(`loaded state from ${filename} (${state.cookies.length} cookies, ${lsKeys.length} localStorage items, ${ssKeys.length} sessionStorage items)`);
}
