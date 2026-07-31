import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveConfig,
  waitForElementState,
  DEFAULTS,
  type ParsedFlags,
} from '../../src/wait-config';
import { parseCommand } from '../../src/daemon/backend';

// Helper: create a temp directory with optional config file
function makeTempDir(configContent?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-v05-'));
  if (configContent) {
    fs.writeFileSync(
      path.join(dir, '.se-cli.json'),
      JSON.stringify(configContent, null, 2) + '\n',
      'utf8'
    );
  }
  return dir;
}

// Helper: clean up temp directory
function cleanupDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Helper: mock driver with timeouts (mirrors wait-config.test.ts pattern)
function makeMockDriver() {
  const timeouts = {
    implicitWait: vi.fn(async (ms: number) => {}),
    pageLoadTimeout: vi.fn(async (ms: number) => {}),
    setScriptTimeout: vi.fn(async (ms: number) => {}),
  };
  const driver = {
    manage: vi.fn(() => ({ timeouts: vi.fn(() => timeouts) })),
    wait: vi.fn(async (condition: any, timeout: number, message?: string) => {}),
  };
  return { driver, timeouts };
}

describe('v0.5 Interaction Completion', () => {

  // ── DEFAULTS.perCommand: v0.5 interactive commands ──────────

  describe('DEFAULTS.perCommand: v0.5 interactive commands (visible+enabled)', () => {
    it('has visible+enabled default for hover', () => {
      expect(DEFAULTS.perCommand.hover).toBeDefined();
      expect(DEFAULTS.perCommand.hover?.wait?.state).toBe('visible+enabled');
    });

    it('has visible+enabled default for dblclick', () => {
      expect(DEFAULTS.perCommand.dblclick).toBeDefined();
      expect(DEFAULTS.perCommand.dblclick?.wait?.state).toBe('visible+enabled');
    });

    it('has visible+enabled default for drag', () => {
      expect(DEFAULTS.perCommand.drag).toBeDefined();
      expect(DEFAULTS.perCommand.drag?.wait?.state).toBe('visible+enabled');
    });

    it('has visible+enabled default for upload', () => {
      expect(DEFAULTS.perCommand.upload).toBeDefined();
      expect(DEFAULTS.perCommand.upload?.wait?.state).toBe('visible+enabled');
    });
  });

  // ── DEFAULTS.perCommand: v0.5 non-interactive commands ──────

  describe('DEFAULTS.perCommand: v0.5 non-interactive commands (none)', () => {
    it('has none default for dialog-accept', () => {
      expect(DEFAULTS.perCommand['dialog-accept']).toBeDefined();
      expect(DEFAULTS.perCommand['dialog-accept']?.wait?.state).toBe('none');
    });

    it('has none default for dialog-dismiss', () => {
      expect(DEFAULTS.perCommand['dialog-dismiss']).toBeDefined();
      expect(DEFAULTS.perCommand['dialog-dismiss']?.wait?.state).toBe('none');
    });

    it('has none default for resize', () => {
      expect(DEFAULTS.perCommand.resize).toBeDefined();
      expect(DEFAULTS.perCommand.resize?.wait?.state).toBe('none');
    });

    it('has none default for keydown', () => {
      expect(DEFAULTS.perCommand.keydown).toBeDefined();
      expect(DEFAULTS.perCommand.keydown?.wait?.state).toBe('none');
    });

    it('has none default for keyup', () => {
      expect(DEFAULTS.perCommand.keyup).toBeDefined();
      expect(DEFAULTS.perCommand.keyup?.wait?.state).toBe('none');
    });

    it('has none default for mousemove', () => {
      expect(DEFAULTS.perCommand.mousemove).toBeDefined();
      expect(DEFAULTS.perCommand.mousemove?.wait?.state).toBe('none');
    });

    it('has none default for mousedown', () => {
      expect(DEFAULTS.perCommand.mousedown).toBeDefined();
      expect(DEFAULTS.perCommand.mousedown?.wait?.state).toBe('none');
    });

    it('has none default for mouseup', () => {
      expect(DEFAULTS.perCommand.mouseup).toBeDefined();
      expect(DEFAULTS.perCommand.mouseup?.wait?.state).toBe('none');
    });

    it('has none default for mousewheel', () => {
      expect(DEFAULTS.perCommand.mousewheel).toBeDefined();
      expect(DEFAULTS.perCommand.mousewheel?.wait?.state).toBe('none');
    });

    it('has none default for actions-chain', () => {
      expect(DEFAULTS.perCommand['actions-chain']).toBeDefined();
      expect(DEFAULTS.perCommand['actions-chain']?.wait?.state).toBe('none');
    });
  });

  // ── resolveConfig: auto state for v0.5 interactive commands ──

  describe('resolveConfig: auto state resolves to visible+enabled for v0.5 interactive commands', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('resolves auto state to visible+enabled for hover', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'hover');
      expect(result.wait.state).toBe('visible+enabled');
    });

    it('resolves auto state to visible+enabled for dblclick', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'dblclick');
      expect(result.wait.state).toBe('visible+enabled');
    });

    it('resolves auto state to visible+enabled for drag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'drag');
      expect(result.wait.state).toBe('visible+enabled');
    });

    it('resolves auto state to visible+enabled for upload', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'upload');
      expect(result.wait.state).toBe('visible+enabled');
    });
  });

  // ── resolveConfig: auto state for v0.5 non-interactive commands ─

  describe('resolveConfig: auto state resolves to none for v0.5 non-interactive commands', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('resolves auto state to none for dialog-accept', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'dialog-accept');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for dialog-dismiss', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'dialog-dismiss');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for resize', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'resize');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for keydown', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'keydown');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for keyup', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'keyup');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for mousemove', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'mousemove');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for mousedown', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'mousedown');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for mouseup', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'mouseup');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for mousewheel', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'mousewheel');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for actions-chain', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'actions-chain');
      expect(result.wait.state).toBe('none');
    });
  });

  // ── resolveConfig: flag overrides for v0.5 commands ───────────

  describe('resolveConfig: flag overrides apply to v0.5 commands', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('--wait flag overrides auto state for hover', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ wait: 'visible' }, tmpCwd, {}, 'hover');
      expect(result.wait.state).toBe('visible');
      expect(result.sources.state).toBe('flag');
    });

    it('--no-wait flag overrides auto state for dblclick', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ 'no-wait': true }, tmpCwd, {}, 'dblclick');
      expect(result.wait.state).toBe('none');
      expect(result.wait.timeout).toBe(0);
      expect(result.sources.state).toBe('flag');
      expect(result.sources.timeout).toBe('flag');
    });

    it('--timeout flag works with drag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ timeout: '15000' }, tmpCwd, {}, 'drag');
      expect(result.wait.timeout).toBe(15000);
      expect(result.sources.timeout).toBe('flag');
    });

    it('--retry flag works with upload', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ retry: '3' }, tmpCwd, {}, 'upload');
      expect(result.wait.retry).toBe(3);
      expect(result.sources.retry).toBe('flag');
    });
  });

  // ── resolveConfig: per-command file config for v0.5 commands ─

  describe('resolveConfig: per-command file config for v0.5 commands', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('per-command file config overrides auto state for hover', () => {
      tmpCwd = makeTempDir({
        perCommand: {
          hover: { wait: { state: 'visible', timeout: 8000 } },
        },
      });
      const result = resolveConfig({}, tmpCwd, {}, 'hover');
      expect(result.wait.state).toBe('visible');
      expect(result.wait.timeout).toBe(8000);
      expect(result.sources.state).toBe('file');
      expect(result.sources.timeout).toBe('file');
    });

    it('per-command file config for hover does not affect dblclick', () => {
      tmpCwd = makeTempDir({
        perCommand: {
          hover: { wait: { state: 'visible', timeout: 8000 } },
        },
      });
      const result = resolveConfig({}, tmpCwd, {}, 'dblclick');
      // dblclick should use its own auto resolution, not hover's config
      expect(result.wait.state).toBe('visible+enabled');
      expect(result.sources.timeout).toBeUndefined();
    });

    it('per-command file config overrides auto state for resize to visible+enabled', () => {
      tmpCwd = makeTempDir({
        perCommand: {
          resize: { wait: { state: 'visible+enabled' } },
        },
      });
      const result = resolveConfig({}, tmpCwd, {}, 'resize');
      expect(result.wait.state).toBe('visible+enabled');
      expect(result.sources.state).toBe('file');
    });
  });

  // ── waitForElementState: compound state for v0.5 commands ────

  describe('waitForElementState: visible+enabled compound state (used by hover/dblclick/drag/upload)', () => {
    it('waits for both visible and enabled states', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'visible+enabled', 5000);
      // driver.wait should be called twice: once for visible, once for enabled
      expect(driver.wait).toHaveBeenCalledTimes(2);
      expect(result).toContain('elementIsVisible');
      expect(result).toContain('elementIsEnabled');
      expect(result).toContain('5000');
    });

    it('returns null for none state (non-interactive v0.5 commands)', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'none', 5000);
      expect(result).toBeNull();
      expect(driver.wait).not.toHaveBeenCalled();
    });
  });

  // ── parseCommand: v0.5 command routing ──────────────────────

  describe('parseCommand: v0.5 interactive commands', () => {
    it('maps hover to browser_hover with target', () => {
      const r = parseCommand(['hover', 'e1']);
      expect(r.toolName).toBe('browser_hover');
      expect(r.toolParams).toEqual({ target: 'e1' });
    });

    it('maps dblclick to browser_dblclick with target', () => {
      const r = parseCommand(['dblclick', 'e1']);
      expect(r.toolName).toBe('browser_dblclick');
      expect(r.toolParams).toEqual({ target: 'e1' });
    });

    it('maps drag to browser_drag with start and end', () => {
      const r = parseCommand(['drag', 'e1', 'e2']);
      expect(r.toolName).toBe('browser_drag');
      expect(r.toolParams).toEqual({ start: 'e1', end: 'e2' });
    });

    it('maps upload to browser_upload with target and file', () => {
      const r = parseCommand(['upload', 'e1', '/path/to/file.txt']);
      expect(r.toolName).toBe('browser_upload');
      expect(r.toolParams).toEqual({ target: 'e1', file: '/path/to/file.txt' });
    });
  });

  describe('parseCommand: v0.5 dialog commands', () => {
    it('maps dialog-accept to browser_dialog_accept with text', () => {
      const r = parseCommand(['dialog-accept', 'OK']);
      expect(r.toolName).toBe('browser_dialog_accept');
      expect(r.toolParams).toEqual({ text: 'OK' });
    });

    it('maps dialog-accept without text (text is undefined)', () => {
      const r = parseCommand(['dialog-accept']);
      expect(r.toolName).toBe('browser_dialog_accept');
      expect(r.toolParams.text).toBeUndefined();
    });

    it('maps dialog-dismiss to browser_dialog_dismiss with no params', () => {
      const r = parseCommand(['dialog-dismiss']);
      expect(r.toolName).toBe('browser_dialog_dismiss');
      expect(r.toolParams).toEqual({});
    });
  });

  describe('parseCommand: v0.5 resize command', () => {
    it('maps resize to browser_resize with parsed width and height', () => {
      const r = parseCommand(['resize', '800', '600']);
      expect(r.toolName).toBe('browser_resize');
      expect(r.toolParams).toEqual({ width: 800, height: 600 });
    });

    it('parses width and height as integers', () => {
      const r = parseCommand(['resize', '1024', '768']);
      expect(r.toolName).toBe('browser_resize');
      expect(typeof r.toolParams.width).toBe('number');
      expect(typeof r.toolParams.height).toBe('number');
      expect(r.toolParams.width).toBe(1024);
      expect(r.toolParams.height).toBe(768);
    });
  });

  describe('parseCommand: v0.5 keyboard commands', () => {
    it('maps keydown to browser_keydown with key', () => {
      const r = parseCommand(['keydown', 'Enter']);
      expect(r.toolName).toBe('browser_keydown');
      expect(r.toolParams).toEqual({ key: 'Enter' });
    });

    it('maps keyup to browser_keyup with key', () => {
      const r = parseCommand(['keyup', 'Enter']);
      expect(r.toolName).toBe('browser_keyup');
      expect(r.toolParams).toEqual({ key: 'Enter' });
    });
  });

  describe('parseCommand: v0.5 mouse commands', () => {
    it('maps mousemove to browser_mousemove with parsed x and y', () => {
      const r = parseCommand(['mousemove', '100', '200']);
      expect(r.toolName).toBe('browser_mousemove');
      expect(r.toolParams).toEqual({ x: 100, y: 200 });
    });

    it('parses mousemove x and y as integers', () => {
      const r = parseCommand(['mousemove', '50', '75']);
      expect(r.toolName).toBe('browser_mousemove');
      expect(typeof r.toolParams.x).toBe('number');
      expect(typeof r.toolParams.y).toBe('number');
      expect(r.toolParams.x).toBe(50);
      expect(r.toolParams.y).toBe(75);
    });

    it('maps mousedown to browser_mousedown with button', () => {
      const r = parseCommand(['mousedown', 'left']);
      expect(r.toolName).toBe('browser_mousedown');
      expect(r.toolParams).toEqual({ button: 'left' });
    });

    it('maps mouseup to browser_mouseup with button', () => {
      const r = parseCommand(['mouseup', 'left']);
      expect(r.toolName).toBe('browser_mouseup');
      expect(r.toolParams).toEqual({ button: 'left' });
    });

    it('maps mousewheel to browser_mousewheel with parsed dx and dy', () => {
      const r = parseCommand(['mousewheel', '10', '5']);
      expect(r.toolName).toBe('browser_mousewheel');
      expect(r.toolParams).toEqual({ dx: 10, dy: 5 });
    });

    it('parses mousewheel dx and dy as integers', () => {
      const r = parseCommand(['mousewheel', '20', '30']);
      expect(r.toolName).toBe('browser_mousewheel');
      expect(typeof r.toolParams.dx).toBe('number');
      expect(typeof r.toolParams.dy).toBe('number');
      expect(r.toolParams.dx).toBe(20);
      expect(r.toolParams.dy).toBe(30);
    });
  });

  describe('parseCommand: v0.5 actions-chain command', () => {
    it('maps actions-chain to browser_actions_chain with actions', () => {
      const actionsJson = '[{"type":"pointerMove","x":100,"y":200}]';
      const r = parseCommand(['actions-chain', actionsJson]);
      expect(r.toolName).toBe('browser_actions_chain');
      expect(r.toolParams).toEqual({ actions: actionsJson });
    });
  });

  // ── parseCommand: flag extraction for v0.5 commands ─────────

  describe('parseCommand: flag extraction for v0.5 commands', () => {
    it('extracts --wait flag for hover', () => {
      const r = parseCommand(['hover', 'e1', '--wait=visible']);
      expect(r.flags.wait).toBe('visible');
    });

    it('extracts --timeout flag for dblclick', () => {
      const r = parseCommand(['dblclick', 'e1', '--timeout=10000']);
      expect(r.flags.timeout).toBe('10000');
    });

    it('extracts --retry flag for drag', () => {
      const r = parseCommand(['drag', 'e1', 'e2', '--retry=3']);
      expect(r.flags.retry).toBe('3');
    });

    it('extracts --no-wait flag for upload', () => {
      const r = parseCommand(['upload', 'e1', 'file.txt', '--no-wait']);
      expect(r.flags['no-wait']).toBe(true);
    });

    it('extracts --retry-interval flag for keydown', () => {
      const r = parseCommand(['keydown', 'Enter', '--retry-interval=500']);
      expect(r.flags['retry-interval']).toBe('500');
    });

    it('returns empty flags when no wait/retry flags provided', () => {
      const r = parseCommand(['hover', 'e1']);
      expect(r.flags).toEqual({});
    });

    it('extracts multiple flags simultaneously for hover', () => {
      const r = parseCommand(['hover', 'e1', '--wait=visible', '--timeout=10000', '--retry=2', '--retry-interval=200']);
      expect(r.flags.wait).toBe('visible');
      expect(r.flags.timeout).toBe('10000');
      expect(r.flags.retry).toBe('2');
      expect(r.flags['retry-interval']).toBe('200');
    });
  });
});
