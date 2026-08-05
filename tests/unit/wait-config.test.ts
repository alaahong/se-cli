import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveConfig,
  loadConfigFile,
  applyTimeouts,
  waitForElementState,
  getConfigValue,
  setConfigValue,
  listConfig,
  generateTemplateConfig,
  DEFAULTS,
  type ParsedFlags,
} from '../../src/wait-config';

// Helper: create a temp directory with optional config file
function makeTempDir(configContent?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-wait-'));
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

// Helper: mock driver with timeouts
function makeMockDriver() {
  const timeouts = {
    setTimeouts: vi.fn(async (conf: Record<string, number>) => {}),
  };
  const driver = {
    manage: vi.fn(() => ({ setTimeouts: timeouts.setTimeouts })),
    wait: vi.fn(async (condition: any, timeout: number, message?: string) => {}),
  };
  return { driver, timeouts };
}

describe('wait-config.ts', () => {

  // ── Default values ──────────────────────────────────────────

  describe('DEFAULTS', () => {
    it('has correct default wait config', () => {
      expect(DEFAULTS.wait.timeout).toBe(5000);
      expect(DEFAULTS.wait.state).toBe('auto');
      expect(DEFAULTS.wait.retry).toBe(0);
      expect(DEFAULTS.wait.retryInterval).toBe(100);
    });

    it('has correct default timeout config', () => {
      expect(DEFAULTS.timeouts.implicit).toBe(0);
      expect(DEFAULTS.timeouts.pageLoad).toBe(30000);
      expect(DEFAULTS.timeouts.script).toBe(30000);
    });

    it('has per-command defaults for interactive commands', () => {
      expect(DEFAULTS.perCommand.click?.wait?.state).toBe('visible+enabled');
      expect(DEFAULTS.perCommand.fill?.wait?.state).toBe('visible+enabled');
      expect(DEFAULTS.perCommand.select?.wait?.state).toBe('visible+enabled');
      expect(DEFAULTS.perCommand.check?.wait?.state).toBe('visible+enabled');
      expect(DEFAULTS.perCommand.uncheck?.wait?.state).toBe('visible+enabled');
    });

    it('has per-command defaults for read-only commands', () => {
      expect(DEFAULTS.perCommand.snapshot?.wait?.state).toBe('none');
      expect(DEFAULTS.perCommand.eval?.wait?.state).toBe('none');
      expect(DEFAULTS.perCommand.find?.wait?.state).toBe('none');
    });

    it('has per-command defaults for v0.9 commands (hyphenated keys)', () => {
      expect(DEFAULTS.perCommand['run-code']?.wait?.state).toBe('none');
      expect(DEFAULTS.perCommand['generate-locator']?.wait?.state).toBe('none');
    });

    it('resolveConfig honors hyphenated per-command entries (run-code)', () => {
      const config = resolveConfig({}, process.cwd(), process.env as any, 'run-code');
      expect(config.wait.state).toBe('none');
      const genConfig = resolveConfig({}, process.cwd(), process.env as any, 'generate-locator');
      expect(genConfig.wait.state).toBe('none');
    });
  });

  // ── resolveConfig: 4-tier priority ──────────────────────────

  describe('resolveConfig', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('returns defaults when no flags, env, or file', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {});
      expect(result.wait.timeout).toBe(5000);
      expect(result.wait.state).toBe('none'); // auto resolves to none without commandName
      expect(result.wait.retry).toBe(0);
      expect(result.wait.retryInterval).toBe(100);
      expect(result.timeouts.implicit).toBe(0);
      expect(result.timeouts.pageLoad).toBe(30000);
      expect(result.timeouts.script).toBe(30000);
    });

    it('resolves auto state to visible+enabled for click command', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'click');
      expect(result.wait.state).toBe('visible+enabled');
      // 'auto' is resolved from defaults, source not set for auto resolution
    });

    it('resolves auto state to visible+enabled for fill command', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'fill');
      expect(result.wait.state).toBe('visible+enabled');
    });

    it('resolves auto state to none for snapshot command', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'snapshot');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for eval command', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'eval');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none for unknown command', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {}, 'unknown');
      expect(result.wait.state).toBe('none');
    });

    it('resolves auto state to none when no command given', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, {});
      expect(result.wait.state).toBe('none');
    });
  });

  // ── Flag layer (highest priority) ───────────────────────────

  describe('resolveConfig: flag layer', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('applies --timeout flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ timeout: '10000' }, tmpCwd, {});
      expect(result.wait.timeout).toBe(10000);
      expect(result.sources.timeout).toBe('flag');
    });

    it('applies --wait flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ wait: 'hidden' }, tmpCwd, {});
      expect(result.wait.state).toBe('hidden');
      expect(result.sources.state).toBe('flag');
    });

    it('applies --retry flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ retry: '3' }, tmpCwd, {});
      expect(result.wait.retry).toBe(3);
      expect(result.sources.retry).toBe('flag');
    });

    it('applies --retry=-1 flag (until timeout)', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ retry: '-1' }, tmpCwd, {});
      expect(result.wait.retry).toBe(-1);
      expect(result.sources.retry).toBe('flag');
    });

    it('applies --retry-interval flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ 'retry-interval': '500' }, tmpCwd, {});
      expect(result.wait.retryInterval).toBe(500);
      expect(result.sources.retryInterval).toBe('flag');
    });

    it('applies --implicit-wait flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ 'implicit-wait': '2000' }, tmpCwd, {});
      expect(result.timeouts.implicit).toBe(2000);
      expect(result.sources.implicit).toBe('flag');
    });

    it('applies --page-load-timeout flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ 'page-load-timeout': '60000' }, tmpCwd, {});
      expect(result.timeouts.pageLoad).toBe(60000);
      expect(result.sources.pageLoad).toBe('flag');
    });

    it('applies --script-timeout flag', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ 'script-timeout': '45000' }, tmpCwd, {});
      expect(result.timeouts.script).toBe(45000);
      expect(result.sources.script).toBe('flag');
    });

    it('applies --no-wait as shorthand for wait=none timeout=0', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({ 'no-wait': true }, tmpCwd, {}, 'click');
      expect(result.wait.state).toBe('none');
      expect(result.wait.timeout).toBe(0);
      expect(result.sources.state).toBe('flag');
      expect(result.sources.timeout).toBe('flag');
    });

    it('flag overrides env and file', () => {
      tmpCwd = makeTempDir({ wait: { timeout: 3000 } });
      const result = resolveConfig(
        { timeout: '10000' },
        tmpCwd,
        { SE_CLI_TIMEOUT: '5000' }
      );
      expect(result.wait.timeout).toBe(10000);
      expect(result.sources.timeout).toBe('flag');
    });
  });

  // ── ENV layer ───────────────────────────────────────────────

  describe('resolveConfig: ENV layer', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('applies SE_CLI_TIMEOUT', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_TIMEOUT: '8000' });
      expect(result.wait.timeout).toBe(8000);
      expect(result.sources.timeout).toBe('env');
    });

    it('applies SE_CLI_WAIT', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_WAIT: 'enabled' });
      expect(result.wait.state).toBe('enabled');
      expect(result.sources.state).toBe('env');
    });

    it('applies SE_CLI_RETRY', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_RETRY: '5' });
      expect(result.wait.retry).toBe(5);
      expect(result.sources.retry).toBe('env');
    });

    it('applies SE_CLI_RETRY_INTERVAL', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_RETRY_INTERVAL: '300' });
      expect(result.wait.retryInterval).toBe(300);
      expect(result.sources.retryInterval).toBe('env');
    });

    it('applies SE_CLI_IMPLICIT_WAIT', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_IMPLICIT_WAIT: '1000' });
      expect(result.timeouts.implicit).toBe(1000);
      expect(result.sources.implicit).toBe('env');
    });

    it('applies SE_CLI_PAGE_LOAD_TIMEOUT', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_PAGE_LOAD_TIMEOUT: '60000' });
      expect(result.timeouts.pageLoad).toBe(60000);
      expect(result.sources.pageLoad).toBe('env');
    });

    it('applies SE_CLI_SCRIPT_TIMEOUT', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_SCRIPT_TIMEOUT: '45000' });
      expect(result.timeouts.script).toBe(45000);
      expect(result.sources.script).toBe('env');
    });

    it('env overrides file', () => {
      tmpCwd = makeTempDir({ wait: { timeout: 3000 } });
      const result = resolveConfig({}, tmpCwd, { SE_CLI_TIMEOUT: '7000' });
      expect(result.wait.timeout).toBe(7000);
      expect(result.sources.timeout).toBe('env');
    });

    it('ignores empty env values', () => {
      tmpCwd = makeTempDir();
      const result = resolveConfig({}, tmpCwd, { SE_CLI_TIMEOUT: '' });
      expect(result.wait.timeout).toBe(5000);
      expect(result.sources.timeout).toBeUndefined();
    });
  });

  // ── Config file layer ──────────────────────────────────────

  describe('resolveConfig: config file layer', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('loads wait.timeout from config file', () => {
      tmpCwd = makeTempDir({ wait: { timeout: 8000 } });
      const result = resolveConfig({}, tmpCwd, {});
      expect(result.wait.timeout).toBe(8000);
      expect(result.sources.timeout).toBe('file');
    });

    it('loads wait.state from config file', () => {
      tmpCwd = makeTempDir({ wait: { state: 'enabled' } });
      const result = resolveConfig({}, tmpCwd, {});
      expect(result.wait.state).toBe('enabled');
      expect(result.sources.state).toBe('file');
    });

    it('loads wait.retry from config file', () => {
      tmpCwd = makeTempDir({ wait: { retry: 2 } });
      const result = resolveConfig({}, tmpCwd, {});
      expect(result.wait.retry).toBe(2);
      expect(result.sources.retry).toBe('file');
    });

    it('loads timeouts from config file', () => {
      tmpCwd = makeTempDir({
        timeouts: { implicit: 500, pageLoad: 45000, script: 20000 }
      });
      const result = resolveConfig({}, tmpCwd, {});
      expect(result.timeouts.implicit).toBe(500);
      expect(result.timeouts.pageLoad).toBe(45000);
      expect(result.timeouts.script).toBe(20000);
      expect(result.sources.implicit).toBe('file');
      expect(result.sources.pageLoad).toBe('file');
      expect(result.sources.script).toBe('file');
    });

    it('loads per-command config from file', () => {
      tmpCwd = makeTempDir({
        perCommand: {
          click: { wait: { state: 'visible', timeout: 8000 } },
        }
      });
      const result = resolveConfig({}, tmpCwd, {}, 'click');
      expect(result.wait.state).toBe('visible');
      expect(result.wait.timeout).toBe(8000);
      expect(result.sources.state).toBe('file');
      expect(result.sources.timeout).toBe('file');
    });

    it('per-command config does not affect other commands', () => {
      tmpCwd = makeTempDir({
        perCommand: {
          click: { wait: { state: 'visible', timeout: 8000 } },
        }
      });
      const result = resolveConfig({}, tmpCwd, {}, 'fill');
      // fill should use defaults, not click's per-command config
      expect(result.wait.timeout).toBe(5000);
      expect(result.sources.timeout).toBeUndefined();
    });

    it('accepts string-shorthand wait in perCommand (spec format)', () => {
      // docs/spec.md documents perCommand as `"click": { "wait": "visible+enabled" }`.
      // The resolver must accept this shorthand in addition to the object form.
      tmpCwd = makeTempDir({
        perCommand: {
          click: { wait: 'visible+enabled' },
        }
      });
      const result = resolveConfig({}, tmpCwd, {}, 'click');
      expect(result.wait.state).toBe('visible+enabled');
      expect(result.sources.state).toBe('file');
    });

    it('file-level global config overrides built-in per-command defaults', () => {
      // Regression: built-in perCommand for click sets state 'visible+enabled'
      // with source 'default'. A file-level global "wait": {"state":"none"}
      // MUST override it (priority: flag > ENV > file > built-in default).
      tmpCwd = makeTempDir({ wait: { state: 'none', timeout: 1000 } });
      const result = resolveConfig({}, tmpCwd, {}, 'click');
      expect(result.wait.state).toBe('none');
      expect(result.sources.state).toBe('file');
      expect(result.wait.timeout).toBe(1000);
      expect(result.sources.timeout).toBe('file');
    });

    it('file-level global config overrides built-in per-command default for snapshot', () => {
      tmpCwd = makeTempDir({ wait: { state: 'visible', timeout: 9000 } });
      const result = resolveConfig({}, tmpCwd, {}, 'snapshot');
      // snapshot has built-in perCommand state 'none' — file global must win
      expect(result.wait.state).toBe('visible');
      expect(result.sources.state).toBe('file');
      expect(result.wait.timeout).toBe(9000);
      expect(result.sources.timeout).toBe('file');
    });
  });

  // ── loadConfigFile ──────────────────────────────────────────

  describe('loadConfigFile', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('returns null when no config file exists', () => {
      tmpCwd = makeTempDir();
      const config = loadConfigFile(tmpCwd);
      expect(config).toBeNull();
    });

    it('loads .se-cli.json from cwd', () => {
      tmpCwd = makeTempDir({ wait: { timeout: 10000 } });
      const config = loadConfigFile(tmpCwd);
      expect(config).not.toBeNull();
      expect(config!.wait.timeout).toBe(10000);
    });

    it('throws on invalid JSON', () => {
      tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-bad-'));
      fs.writeFileSync(path.join(tmpCwd, '.se-cli.json'), '{invalid json}', 'utf8');
      expect(() => loadConfigFile(tmpCwd)).toThrow();
    });
  });

  // ── applyTimeouts ───────────────────────────────────────────

  describe('applyTimeouts', () => {
    it('merges all timeouts into a single W3C setTimeouts call', async () => {
      const { driver, timeouts } = makeMockDriver();
      await applyTimeouts(driver, { implicit: 1000, pageLoad: 30000, script: 30000 });
      expect(timeouts.setTimeouts).toHaveBeenCalledWith({
        implicit: 1000,
        pageLoad: 30000,
        script: 30000,
      });
    });

    it('omits implicit when it is 0 (driver default)', async () => {
      const { driver, timeouts } = makeMockDriver();
      await applyTimeouts(driver, { implicit: 0, pageLoad: 30000, script: 30000 });
      expect(timeouts.setTimeouts).toHaveBeenCalledWith({
        pageLoad: 30000,
        script: 30000,
      });
    });

    it('does not call manage() when all timeouts are 0', async () => {
      const { driver, timeouts } = makeMockDriver();
      await applyTimeouts(driver, { implicit: 0, pageLoad: 0, script: 0 });
      expect(timeouts.setTimeouts).not.toHaveBeenCalled();
    });
  });

  // ── waitForElementState ─────────────────────────────────────

  describe('waitForElementState', () => {
    it('returns null for none state', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'none', 5000);
      expect(result).toBeNull();
      expect(driver.wait).not.toHaveBeenCalled();
    });

    it('returns null when timeout is 0', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'visible', 0);
      expect(result).toBeNull();
      expect(driver.wait).not.toHaveBeenCalled();
    });

    it('waits for visible state and returns code snippet', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'visible', 5000);
      expect(driver.wait).toHaveBeenCalled();
      expect(result).toContain('elementIsVisible');
      expect(result).toContain('5000');
    });

    it('waits for hidden state', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'hidden', 3000);
      expect(driver.wait).toHaveBeenCalled();
      expect(result).toContain('elementIsNotVisible');
    });

    it('waits for enabled state', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'enabled', 5000);
      expect(result).toContain('elementIsEnabled');
    });

    it('waits for disabled state', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'disabled', 5000);
      expect(result).toContain('elementIsDisabled');
    });

    it('waits for stable state (staleness)', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'stable', 5000);
      expect(result).toContain('stalenessOf');
    });

    it('waits for attached state', async () => {
      const { driver } = makeMockDriver();
      const el = {};
      const result = await waitForElementState(driver, el, 'attached', 5000);
      expect(driver.wait).toHaveBeenCalled();
      expect(result).toContain('attached');
    });
  });

  // ── Config command helpers ──────────────────────────────────

  describe('getConfigValue', () => {
    it('gets nested value by dot path', () => {
      const config = {
        wait: { timeout: 8000, state: 'visible' },
        timeouts: { implicit: 0, pageLoad: 30000, script: 30000 },
        perCommand: {},
      };
      expect(getConfigValue(config as any, 'wait.timeout')?.value).toBe(8000);
      expect(getConfigValue(config as any, 'wait.state')?.value).toBe('visible');
      expect(getConfigValue(config as any, 'timeouts.implicit')?.value).toBe(0);
    });

    it('returns null for non-existent key', () => {
      const config = {
        wait: { timeout: 5000 },
        timeouts: { implicit: 0 },
        perCommand: {},
      };
      expect(getConfigValue(config as any, 'wait.nonexistent')).toBeNull();
      expect(getConfigValue(config as any, 'nonexistent.key')).toBeNull();
    });
  });

  describe('setConfigValue', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('creates new config file if not exists', () => {
      tmpCwd = makeTempDir();
      setConfigValue(tmpCwd, 'wait.timeout', '12000');
      const configPath = path.join(tmpCwd, '.se-cli.json');
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(config.wait.timeout).toBe(12000);
    });

    it('updates existing config file', () => {
      tmpCwd = makeTempDir({ wait: { timeout: 5000 } });
      setConfigValue(tmpCwd, 'wait.timeout', '15000');
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpCwd, '.se-cli.json'), 'utf8')
      );
      expect(config.wait.timeout).toBe(15000);
    });

    it('parses numeric values', () => {
      tmpCwd = makeTempDir();
      setConfigValue(tmpCwd, 'wait.timeout', '9999');
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpCwd, '.se-cli.json'), 'utf8')
      );
      expect(config.wait.timeout).toBe(9999);
      expect(typeof config.wait.timeout).toBe('number');
    });

    it('parses boolean values', () => {
      tmpCwd = makeTempDir();
      setConfigValue(tmpCwd, 'wait.enabled', 'true');
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpCwd, '.se-cli.json'), 'utf8')
      );
      expect(config.wait.enabled).toBe(true);
    });

    it('creates nested objects as needed', () => {
      tmpCwd = makeTempDir();
      setConfigValue(tmpCwd, 'perCommand.click.wait.state', 'visible');
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpCwd, '.se-cli.json'), 'utf8')
      );
      expect(config.perCommand.click.wait.state).toBe('visible');
    });
  });

  describe('listConfig', () => {
    it('returns all config items with sources', () => {
      const result = listConfig({
        wait: { timeout: 5000, state: 'visible', retry: 0, retryInterval: 100 },
        timeouts: { implicit: 0, pageLoad: 30000, script: 30000 },
        sources: {
          timeout: 'flag',
          state: 'env',
          retry: 'default',
          retryInterval: 'default',
          implicit: 'file',
          pageLoad: 'default',
          script: 'default',
        },
      });
      expect(result.length).toBe(7);
      expect(result[0]).toContain('wait.timeout');
      expect(result[0]).toContain('5000');
      expect(result[0]).toContain('flag');
      expect(result[1]).toContain('wait.state');
      expect(result[1]).toContain('env');
    });

    it('uses default when source not in map', () => {
      const result = listConfig({
        wait: { timeout: 5000, state: 'none', retry: 0, retryInterval: 100 },
        timeouts: { implicit: 0, pageLoad: 30000, script: 30000 },
        sources: {},
      });
      expect(result[0]).toContain('default');
    });
  });

  describe('generateTemplateConfig', () => {
    let tmpCwd: string;

    afterEach(() => {
      if (tmpCwd) cleanupDir(tmpCwd);
    });

    it('creates .se-cli.json template', () => {
      tmpCwd = makeTempDir();
      const content = generateTemplateConfig(tmpCwd);
      const configPath = path.join(tmpCwd, '.se-cli.json');
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(content);
      expect(config.wait.timeout).toBe(5000);
      expect(config.wait.state).toBe('auto');
      expect(config.timeouts.implicit).toBe(0);
      expect(config.perCommand.click).toBeDefined();
    });

    it('does not overwrite existing config file', () => {
      tmpCwd = makeTempDir({ wait: { timeout: 9999 } });
      generateTemplateConfig(tmpCwd);
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpCwd, '.se-cli.json'), 'utf8')
      );
      // Should still have the original value
      expect(config.wait.timeout).toBe(9999);
    });
  });
});
