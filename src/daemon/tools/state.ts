import { Response } from '../../response';
import * as fs from 'fs';
import * as path from 'path';
import { safeFilename } from './shared';
import { getEmulationState, setEmulationState, applyEmulation, describeEmulation } from './emulation-state';

interface BrowserState {
  url: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  emulation?: any;
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

  // 5. Capture the active emulation state (v0.8) so state-load can replay it.
  const emulation = getEmulationState();

  // 6. Assemble the state object.
  const state: BrowserState = {
    url,
    cookies,
    localStorage: localStorageData || {},
    sessionStorage: sessionStorageData || {},
    emulation: Object.keys(emulation).length > 0 ? emulation : undefined,
    savedAt: new Date().toISOString(),
  };

  // 7. Write to .se-cli/<filename> (same I/O pattern as screenshot.ts).
  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `state-${Date.now()}.json`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, JSON.stringify(state, null, 2));

  response.addCode(`const cookies = await driver.manage().getCookies();\nconst localStorageData = await driver.executeScript('return (() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })();');\nconst sessionStorageData = await driver.executeScript('return (() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return o; })();');\nconst url = await driver.getCurrentUrl();\nfs.writeFileSync('${filename}', JSON.stringify({ url, cookies, localStorage: localStorageData, sessionStorage: sessionStorageData, emulation: ${JSON.stringify(emulation)}, savedAt: new Date().toISOString() }, null, 2));`);
  response.addResult(`[State](.se-cli/${filename}) (${cookies.length} cookies, ${Object.keys(state.localStorage).length} localStorage items, ${Object.keys(state.sessionStorage).length} sessionStorage items${state.emulation ? `, emulation: ${describeEmulation(state.emulation)}` : ''})`);
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
  //    driver is on a matching domain. Guard against missing fields in
  //    hand-edited or older state files.
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  const localStorageData = state.localStorage && typeof state.localStorage === 'object' ? state.localStorage : {};
  const sessionStorageData = state.sessionStorage && typeof state.sessionStorage === 'object' ? state.sessionStorage : {};

  if (state.url) {
    await driver.get(state.url);
  }

  // 4. Clear existing cookies before restoring.
  await driver.manage().deleteAllCookies();

  // 5. Restore cookies.
  //    Firefox enforces that SameSite=None cookies must also be Secure.
  //    Sanitize cookies before passing to addCookie to avoid driver errors.
  for (const cookie of cookies) {
    const sanitized = { ...cookie };
    if (sanitized.sameSite === 'None' && !sanitized.secure) {
      sanitized.secure = true;
    }
    await driver.manage().addCookie(sanitized);
  }

  // 6. Restore localStorage.
  const lsKeys = Object.keys(localStorageData);
  for (const k of lsKeys) {
    await driver.executeScript('localStorage.setItem(arguments[0], arguments[1]);', k, localStorageData[k]);
  }

  // 7. Restore sessionStorage.
  const ssKeys = Object.keys(sessionStorageData);
  for (const k of ssKeys) {
    await driver.executeScript('sessionStorage.setItem(arguments[0], arguments[1]);', k, sessionStorageData[k]);
  }

  // 8. Restore emulation state (v0.8) — replayed via CDP/BiDi after navigation.
  //    Guard against hand-edited files: only apply known keys.
  let emulationRestored = false;
  const patch: any = {};
  if (state.emulation && typeof state.emulation === 'object') {
    const emu = state.emulation;
    if (emu.viewport && typeof emu.viewport === 'object') patch.viewport = emu.viewport;
    if (typeof emu.userAgent === 'string') patch.userAgent = emu.userAgent;
    if (typeof emu.locale === 'string') patch.locale = emu.locale;
    if (emu.colorScheme === 'light' || emu.colorScheme === 'dark') patch.colorScheme = emu.colorScheme;
    if (typeof emu.timezone === 'string') patch.timezone = emu.timezone;
    if (emu.geolocation && typeof emu.geolocation === 'object') patch.geolocation = emu.geolocation;
    if (Array.isArray(emu.permissions)) patch.permissions = emu.permissions;
    if (typeof emu.offline === 'boolean') patch.offline = emu.offline;
    if (emu.throttleNetwork && typeof emu.throttleNetwork === 'object') patch.throttleNetwork = emu.throttleNetwork;
    if (typeof emu.throttleCpu === 'number') patch.throttleCpu = emu.throttleCpu;
    if (Object.keys(patch).length > 0) {
      setEmulationState(patch);
      await applyEmulation(driver);
      emulationRestored = true;
    }
  }

  response.addCode(`const state = JSON.parse(fs.readFileSync('${filename}', 'utf8'));\nawait driver.get(state.url);\nawait driver.manage().deleteAllCookies();\nfor (const cookie of state.cookies) { await driver.manage().addCookie(cookie); }\nfor (const k of Object.keys(state.localStorage)) { await driver.executeScript('localStorage.setItem(arguments[0], arguments[1]);', k, state.localStorage[k]); }\nfor (const k of Object.keys(state.sessionStorage)) { await driver.executeScript('sessionStorage.setItem(arguments[0], arguments[1]);', k, state.sessionStorage[k]); }${emulationRestored ? `\n// emulation restored: ${describeEmulation(patch)}` : ''}`);
  response.addResult(`loaded state from ${filename} (${cookies.length} cookies, ${lsKeys.length} localStorage items, ${ssKeys.length} sessionStorage items${emulationRestored ? `, emulation: ${describeEmulation(patch)}` : ''})`);
}
