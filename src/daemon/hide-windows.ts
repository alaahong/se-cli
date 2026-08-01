// NOTE: must use require() — `import * as childProcess` compiles to
// __importStar(require(...)) which creates a COPY of the exports with
// getter-only, non-configurable properties, so patching that copy would
// not affect selenium-webdriver's own require('node:child_process') call.
// require() returns the real module.exports object, which both we and
// selenium-webdriver share.
const childProcess = require('child_process') as any;

// selenium-webdriver spawns selenium-manager.exe (via spawnSync in
// common/seleniumManager.js) and the browser driver binary (via spawn in
// io/exec.js) WITHOUT windowsHide. When the daemon itself runs with
// windowsHide (no console), Windows creates a NEW console window for each
// of those child processes, causing a visible console window to flash
// (or persist for the driver) on every driver startup. Patching
// child_process here forces windowsHide: true for every child process
// spawned by the daemon.
let installed = false;

export function hideChildProcessWindows(): void {
  if (installed) return;
  installed = true;

  const origSpawn = childProcess.spawn as any;
  const origSpawnSync = childProcess.spawnSync as any;
  const cp = childProcess as any;

  // Node >= 22 exposes CJS named exports as getter-only accessors (no
  // setter), so plain assignment throws "Cannot set property ... which
  // has only a getter". defineProperty works because they are configurable.
  Object.defineProperty(cp, 'spawn', {
    value: (command: any, args?: any, options?: any) =>
      origSpawn(command, args, { ...options, windowsHide: true }),
    writable: true,
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(cp, 'spawnSync', {
    value: (command: any, args?: any, options?: any) =>
      origSpawnSync(command, args, { ...options, windowsHide: true }),
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
