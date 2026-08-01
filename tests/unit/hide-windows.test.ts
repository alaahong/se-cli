import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

// hide-windows.ts uses require('child_process') to get the REAL module
// exports object (import * as compiles to __importStar which copies the
// exports into a non-configurable wrapper). To verify the patch, we must
// inspect the same real object, so we bypass Vitest's ESM interop here.
const require = createRequire(import.meta.url);
const realCp: any = require('child_process');

const origSpawn = realCp.spawn;
const origSpawnSync = realCp.spawnSync;

import { hideChildProcessWindows } from '../../src/daemon/hide-windows';

const spawnSpy = vi.fn(() => ({ unref: vi.fn(), on: vi.fn(), kill: vi.fn() }));
const spawnSyncSpy = vi.fn(() => ({ status: 0, stdout: Buffer.from('{}'), stderr: Buffer.from('') }));

describe('hideChildProcessWindows', () => {
  beforeAll(() => {
    Object.defineProperty(realCp, 'spawn', { value: spawnSpy, writable: true, configurable: true });
    Object.defineProperty(realCp, 'spawnSync', { value: spawnSyncSpy, writable: true, configurable: true });
    hideChildProcessWindows();
  });

  afterAll(() => {
    Object.defineProperty(realCp, 'spawn', { value: origSpawn, writable: true, configurable: true });
    Object.defineProperty(realCp, 'spawnSync', { value: origSpawnSync, writable: true, configurable: true });
  });

  it('injects windowsHide: true into spawn options while preserving them', () => {
    realCp.spawn('cmd', ['--flag'], { stdio: 'pipe' });

    expect(spawnSpy).toHaveBeenCalledWith(
      'cmd',
      ['--flag'],
      expect.objectContaining({ stdio: 'pipe', windowsHide: true }),
    );
  });

  it('injects windowsHide: true into spawnSync options while preserving them', () => {
    realCp.spawnSync('selenium-manager.exe', ['--browser', 'chrome']);

    expect(spawnSyncSpy).toHaveBeenCalledWith(
      'selenium-manager.exe',
      ['--browser', 'chrome'],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('overrides an explicit windowsHide: false', () => {
    realCp.spawn('cmd', [], { windowsHide: false });

    expect(spawnSpy).toHaveBeenLastCalledWith('cmd', [], expect.objectContaining({ windowsHide: true }));
  });

  it('is idempotent — a second call does not re-wrap the patched functions', () => {
    const before = realCp.spawn;
    hideChildProcessWindows();
    expect(realCp.spawn).toBe(before);
  });
});
