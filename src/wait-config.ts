/**
 * v0.4 Wait & Retry Configuration Layer
 *
 * 4-tier priority (high → low): --flag > ENV > .se-cli.json > built-in default
 *
 * This module resolves the effective wait/retry/timeout configuration for a
 * given command invocation, applies it to the driver, and provides wait-aware
 * code generation strings.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────

export type WaitState =
  | 'visible' | 'hidden' | 'enabled' | 'disabled'
  | 'stable' | 'attached' | 'none' | 'auto';

export interface WaitConfig {
  timeout: number;
  state: WaitState;
  retry: number;
  retryInterval: number;
}

export interface TimeoutConfig {
  implicit: number;
  pageLoad: number;
  script: number;
}

export interface PerCommandConfig {
  wait?: Partial<WaitConfig>;
  scriptTimeout?: number;
}

export interface SeCliConfig {
  wait: {
    timeout?: number;
    state?: WaitState;
    retry?: number;
    retryInterval?: number;
  };
  timeouts: {
    implicit?: number;
    pageLoad?: number;
    script?: number;
  };
  perCommand: Record<string, PerCommandConfig>;
}

export interface ResolvedConfig {
  wait: WaitConfig;
  timeouts: TimeoutConfig;
  /** Source map: key → 'flag' | 'env' | 'file' | 'default' */
  sources: Record<string, 'flag' | 'env' | 'file' | 'default'>;
}

// ── Defaults ──────────────────────────────────────────────────────

export const DEFAULTS: { wait: WaitConfig; timeouts: TimeoutConfig; perCommand: Record<string, PerCommandConfig> } = {
  wait: {
    timeout: 5000,
    state: 'auto',
    retry: 0,
    retryInterval: 100,
  },
  timeouts: {
    implicit: 0,
    pageLoad: 30000,
    script: 30000,
  },
  perCommand: {
    click:    { wait: { state: 'visible+enabled' as WaitState } },
    fill:     { wait: { state: 'visible+enabled' as WaitState } },
    select:   { wait: { state: 'visible+enabled' as WaitState } },
    check:    { wait: { state: 'visible+enabled' as WaitState } },
    uncheck:  { wait: { state: 'visible+enabled' as WaitState } },
    // v0.5: interactive tools
    hover:    { wait: { state: 'visible+enabled' as WaitState } },
    dblclick: { wait: { state: 'visible+enabled' as WaitState } },
    drag:     { wait: { state: 'visible+enabled' as WaitState } },
    upload:   { wait: { state: 'visible+enabled' as WaitState } },
    // v0.5: read-only / no-element tools
    snapshot: { wait: { state: 'none' } },
    eval:     { wait: { state: 'none' } },
    // v0.9: run-code — arbitrary Selenium snippet, no implicit waiting
    'run-code': { wait: { state: 'none' } },
    // v0.9: generate-locator — read-only inspection, no implicit waiting
    'generate-locator': { wait: { state: 'none' } },
    find:     { wait: { state: 'none' } },
    screenshot: { wait: { state: 'none' } },
    'dialog-accept':  { wait: { state: 'none' } },
    'dialog-dismiss': { wait: { state: 'none' } },
    resize:   { wait: { state: 'none' } },
    keydown:  { wait: { state: 'none' } },
    keyup:    { wait: { state: 'none' } },
    mousemove:  { wait: { state: 'none' } },
    mousedown:  { wait: { state: 'none' } },
    mouseup:    { wait: { state: 'none' } },
    mousewheel: { wait: { state: 'none' } },
    'actions-chain': { wait: { state: 'none' } },
    // v0.6: assertions — use 'attached' so timeout is passed through _wait
    expect:   { wait: { state: 'attached' as WaitState } },
  },
};

// ── ENV var name mapping ─────────────────────────────────────────

const ENV_MAP: Record<string, { key: string; parse: (v: string) => any; configPath: string }> = {
  SE_CLI_TIMEOUT:          { key: 'timeout',       parse: parseInt, configPath: 'wait.timeout' },
  SE_CLI_WAIT:             { key: 'state',         parse: (v) => v,  configPath: 'wait.state' },
  SE_CLI_RETRY:            { key: 'retry',         parse: parseInt, configPath: 'wait.retry' },
  SE_CLI_RETRY_INTERVAL:   { key: 'retryInterval', parse: parseInt, configPath: 'wait.retryInterval' },
  SE_CLI_IMPLICIT_WAIT:    { key: 'implicit',      parse: parseInt, configPath: 'timeouts.implicit' },
  SE_CLI_PAGE_LOAD_TIMEOUT:{ key: 'pageLoad',      parse: parseInt, configPath: 'timeouts.pageLoad' },
  SE_CLI_SCRIPT_TIMEOUT:   { key: 'script',         parse: parseInt, configPath: 'timeouts.script' },
};

// ── Config file loading ──────────────────────────────────────────

/**
 * Load .se-cli.json from the workspace directory (cwd), falling back to
 * ~/.config/se-cli/config.json. Returns null if no file is found.
 */
export function loadConfigFile(cwd: string): SeCliConfig | null {
  // 1. Check .se-cli.json in the workspace directory
  const localPath = path.join(cwd, '.se-cli.json');
  if (fs.existsSync(localPath)) {
    try {
      return parseConfigFile(fs.readFileSync(localPath, 'utf8'));
    } catch (e: any) {
      throw new Error(`Failed to parse ${localPath}: ${e.message}`);
    }
  }

  // 2. Check ~/.config/se-cli/config.json
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const globalPath = path.join(home, '.config', 'se-cli', 'config.json');
    if (fs.existsSync(globalPath)) {
      try {
        return parseConfigFile(fs.readFileSync(globalPath, 'utf8'));
      } catch (e: any) {
        throw new Error(`Failed to parse ${globalPath}: ${e.message}`);
      }
    }
  }

  return null;
}

function parseConfigFile(content: string): SeCliConfig {
  const raw = JSON.parse(content);
  const perCommand: Record<string, PerCommandConfig> = {};
  for (const [name, rawPc] of Object.entries(raw.perCommand ?? {})) {
    const entry: PerCommandConfig = {};
    const pc = rawPc as any;
    // Accept both the full object form `{ wait: { state: "visible" } }`
    // and the spec-documented string shorthand `{ wait: "visible" }`.
    if (typeof pc?.wait === 'string') {
      entry.wait = { state: pc.wait as WaitState };
    } else if (pc?.wait && typeof pc.wait === 'object') {
      entry.wait = { ...pc.wait };
    }
    if (pc?.scriptTimeout !== undefined) {
      entry.scriptTimeout = pc.scriptTimeout;
    }
    perCommand[name] = entry;
  }
  return {
    wait: {
      timeout: raw.wait?.timeout,
      state: raw.wait?.state,
      retry: raw.wait?.retry,
      retryInterval: raw.wait?.retryInterval,
    },
    timeouts: {
      implicit: raw.timeouts?.implicit,
      pageLoad: raw.timeouts?.pageLoad,
      script: raw.timeouts?.script,
    },
    perCommand,
  };
}

// ── Flag extraction ──────────────────────────────────────────────

export interface ParsedFlags {
  timeout?: string;
  wait?: string;
  retry?: string;
  'retry-interval'?: string;
  'implicit-wait'?: string;
  'page-load-timeout'?: string;
  'script-timeout'?: string;
  'no-wait'?: boolean;
  [key: string]: any;
}

/**
 * Resolve the effective configuration from 4-tier priority.
 *
 * @param flags  Parsed CLI flags (from minimist)
 * @param cwd    Current working directory (for config file lookup)
 * @param env    Process environment (defaults to process.env)
 * @param commandName  The tool command name (e.g. 'click') for per-command overrides
 */
export function resolveConfig(
  flags: ParsedFlags,
  cwd: string,
  env: Record<string, string | undefined> = process.env as any,
  commandName?: string,
): ResolvedConfig {
  const fileConfig = loadConfigFile(cwd);
  const sources: Record<string, 'flag' | 'env' | 'file' | 'default'> = {};

  // Start with defaults
  const result: ResolvedConfig = {
    wait: {
      timeout: DEFAULTS.wait.timeout,
      state: DEFAULTS.wait.state,
      retry: DEFAULTS.wait.retry,
      retryInterval: DEFAULTS.wait.retryInterval,
    },
    timeouts: {
      implicit: DEFAULTS.timeouts.implicit,
      pageLoad: DEFAULTS.timeouts.pageLoad,
      script: DEFAULTS.timeouts.script,
    },
    sources,
  };

  // Apply built-in per-command defaults (lowest priority after global defaults)
  if (commandName && DEFAULTS.perCommand[commandName]) {
    const pc = DEFAULTS.perCommand[commandName];
    if (pc.wait?.timeout !== undefined) {
      result.wait.timeout = pc.wait.timeout;
      sources.timeout = 'default';
    }
    if (pc.wait?.state !== undefined) {
      result.wait.state = pc.wait.state;
      sources.state = 'default';
    }
    if (pc.wait?.retry !== undefined) {
      result.wait.retry = pc.wait.retry;
      sources.retry = 'default';
    }
    if (pc.wait?.retryInterval !== undefined) {
      result.wait.retryInterval = pc.wait.retryInterval;
      sources.retryInterval = 'default';
    }
    if (pc.scriptTimeout !== undefined) {
      result.timeouts.script = pc.scriptTimeout;
      sources.script = 'default';
    }
  }

  // Apply per-command overrides from file config (higher priority than built-in)
  if (fileConfig && commandName && fileConfig.perCommand[commandName]) {
    const pc = fileConfig.perCommand[commandName];
    if (pc.wait?.timeout !== undefined) {
      result.wait.timeout = pc.wait.timeout;
      sources.timeout = 'file';
    }
    if (pc.wait?.state !== undefined) {
      result.wait.state = pc.wait.state;
      sources.state = 'file';
    }
    if (pc.wait?.retry !== undefined) {
      result.wait.retry = pc.wait.retry;
      sources.retry = 'file';
    }
    if (pc.wait?.retryInterval !== undefined) {
      result.wait.retryInterval = pc.wait.retryInterval;
      sources.retryInterval = 'file';
    }
    if (pc.scriptTimeout !== undefined) {
      result.timeouts.script = pc.scriptTimeout;
      sources.script = 'file';
    }
  }

  // Apply file-level defaults. These override built-in defaults (including
  // built-in per-command defaults, which are marked with source 'default')
  // per the declared priority: --flag > ENV > .se-cli.json > built-in default.
  // They do NOT override file-level per-command overrides ('file') or higher
  // layers ('env'/'flag').
  if (fileConfig) {
    if ((sources.timeout === undefined || sources.timeout === 'default') && fileConfig.wait.timeout !== undefined) {
      result.wait.timeout = fileConfig.wait.timeout;
      sources.timeout = 'file';
    }
    if ((sources.state === undefined || sources.state === 'default') && fileConfig.wait.state !== undefined) {
      result.wait.state = fileConfig.wait.state;
      sources.state = 'file';
    }
    if ((sources.retry === undefined || sources.retry === 'default') && fileConfig.wait.retry !== undefined) {
      result.wait.retry = fileConfig.wait.retry;
      sources.retry = 'file';
    }
    if ((sources.retryInterval === undefined || sources.retryInterval === 'default') && fileConfig.wait.retryInterval !== undefined) {
      result.wait.retryInterval = fileConfig.wait.retryInterval;
      sources.retryInterval = 'file';
    }
    if ((sources.implicit === undefined || sources.implicit === 'default') && fileConfig.timeouts.implicit !== undefined) {
      result.timeouts.implicit = fileConfig.timeouts.implicit;
      sources.implicit = 'file';
    }
    if ((sources.pageLoad === undefined || sources.pageLoad === 'default') && fileConfig.timeouts.pageLoad !== undefined) {
      result.timeouts.pageLoad = fileConfig.timeouts.pageLoad;
      sources.pageLoad = 'file';
    }
    if ((sources.script === undefined || sources.script === 'default') && fileConfig.timeouts.script !== undefined) {
      result.timeouts.script = fileConfig.timeouts.script;
      sources.script = 'file';
    }
  }

  // Apply ENV layer
  for (const [envName, mapping] of Object.entries(ENV_MAP)) {
    const envVal = env[envName];
    if (envVal !== undefined && envVal !== '') {
      const parsed = mapping.parse(envVal);
      const keys = mapping.configPath.split('.');
      if (keys[0] === 'wait') {
        (result.wait as any)[keys[1]] = parsed;
      } else if (keys[0] === 'timeouts') {
        (result.timeouts as any)[keys[1]] = parsed;
      }
      sources[keys[1]] = 'env';
    }
  }

  // Apply flag layer (highest priority).
  // Invalid numeric values (e.g. --timeout=abc → NaN) are ignored so they
  // don't poison the effective config with NaN comparisons.
  const toInt = (v: string): number | undefined => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const flagTimeout = flags.timeout !== undefined ? toInt(flags.timeout) : undefined;
  if (flagTimeout !== undefined) {
    result.wait.timeout = flagTimeout;
    sources.timeout = 'flag';
  }
  if (flags.wait !== undefined) {
    result.wait.state = flags.wait as WaitState;
    sources.state = 'flag';
  }
  const flagRetry = flags.retry !== undefined ? toInt(flags.retry) : undefined;
  if (flagRetry !== undefined) {
    result.wait.retry = flagRetry;
    sources.retry = 'flag';
  }
  const flagRetryInterval = flags['retry-interval'] !== undefined ? toInt(flags['retry-interval']) : undefined;
  if (flagRetryInterval !== undefined) {
    result.wait.retryInterval = flagRetryInterval;
    sources.retryInterval = 'flag';
  }
  const flagImplicit = flags['implicit-wait'] !== undefined ? toInt(flags['implicit-wait']) : undefined;
  if (flagImplicit !== undefined) {
    result.timeouts.implicit = flagImplicit;
    sources.implicit = 'flag';
  }
  const flagPageLoad = flags['page-load-timeout'] !== undefined ? toInt(flags['page-load-timeout']) : undefined;
  if (flagPageLoad !== undefined) {
    result.timeouts.pageLoad = flagPageLoad;
    sources.pageLoad = 'flag';
  }
  const flagScript = flags['script-timeout'] !== undefined ? toInt(flags['script-timeout']) : undefined;
  if (flagScript !== undefined) {
    result.timeouts.script = flagScript;
    sources.script = 'flag';
  }

  // --no-wait shorthand: --wait=none --timeout=0
  if (flags['no-wait']) {
    result.wait.state = 'none';
    result.wait.timeout = 0;
    sources.state = 'flag';
    sources.timeout = 'flag';
  }

  // For 'auto' state, resolve based on command name
  if (result.wait.state === 'auto') {
    result.wait.state = resolveAutoState(commandName);
  }

  return result;
}

/**
 * Resolve 'auto' wait state based on command name.
 * - click/fill/select/check/uncheck/hover/dblclick/drag/upload => 'visible+enabled'
 * - snapshot/eval/find/screenshot/dialog/resize/keydown/keyup/mouse/actions-chain => 'none'
 * - everything else => 'none'
 */
function resolveAutoState(commandName?: string): WaitState {
  if (!commandName) return 'none';
  const interactiveCommands = new Set(['click', 'fill', 'select', 'check', 'uncheck', 'hover', 'dblclick', 'drag', 'upload']);
  if (interactiveCommands.has(commandName)) return 'visible+enabled' as WaitState;
  return 'none';
}

// ── Driver application ───────────────────────────────────────────

/**
 * Apply timeout settings to the driver.
 * Called at the start of callTool.
 *
 * Uses the W3C `manage().setTimeouts({implicit, pageLoad, script})` API.
 * The legacy chained API (`timeouts().implicitWait()` etc.) was removed
 * from selenium-webdriver 4.x — calling it threw a TypeError that
 * backend.ts silently swallowed, making all timeout flags ineffective.
 */
export async function applyTimeouts(driver: any, config: TimeoutConfig): Promise<void> {
  const timeouts: Record<string, number> = {};
  if (config.implicit > 0) timeouts.implicit = config.implicit;
  if (config.pageLoad > 0) timeouts.pageLoad = config.pageLoad;
  if (config.script > 0) timeouts.script = config.script;
  if (Object.keys(timeouts).length === 0) return;
  await driver.manage().setTimeouts(timeouts);
}

/**
 * Wait for an element to reach the specified state(s).
 * Supports compound states like "visible+enabled" — each sub-state is waited
 * for sequentially, and all code-gen lines are returned.
 *
 * Returns a code-gen snippet string (may be multi-line), or null if no wait is needed.
 */
export async function waitForElementState(
  driver: any,
  el: any,
  state: WaitState,
  timeout: number,
): Promise<string | null> {
  if (state === 'none' || timeout <= 0) return null;

  // Support compound states like "visible+enabled"
  const states = state.split('+') as WaitState[];
  const codeGenLines: string[] = [];

  for (const subState of states) {
    const code = await waitForSingleState(driver, el, subState, timeout);
    if (code) codeGenLines.push(code);
  }

  return codeGenLines.length > 0 ? codeGenLines.join('\n') : null;
}

/**
 * Wait for a single atomic element state.
 */
async function waitForSingleState(
  driver: any,
  el: any,
  state: WaitState,
  timeout: number,
): Promise<string | null> {
  const { until } = require('selenium-webdriver');
  let condition: any = null;
  let codeGen: string = '';

  switch (state) {
    case 'visible':
      condition = until.elementIsVisible(el);
      codeGen = `await driver.wait(until.elementIsVisible(el), ${timeout});`;
      break;
    case 'hidden':
      condition = until.elementIsNotVisible(el);
      codeGen = `await driver.wait(until.elementIsNotVisible(el), ${timeout});`;
      break;
    case 'enabled':
      condition = until.elementIsEnabled(el);
      codeGen = `await driver.wait(until.elementIsEnabled(el), ${timeout});`;
      break;
    case 'disabled':
      condition = until.elementIsDisabled(el);
      codeGen = `await driver.wait(until.elementIsDisabled(el), ${timeout});`;
      break;
    case 'stable':
      // Wait until the element's geometry (position + size) stops changing
      // between consecutive checks. Playwright's "stable" semantics: the
      // element is not animating / mid-layout. (until.stalenessOf — "wait for
      // the element to detach" — is the opposite and was wrong here.)
      condition = async () => {
        try {
          const r1 = await el.getRect();
          await new Promise(r => setTimeout(r, 100));
          const r2 = await el.getRect();
          return (
            r1.x === r2.x &&
            r1.y === r2.y &&
            r1.width === r2.width &&
            r1.height === r2.height
          );
        } catch {
          return false; // stale or not attached yet — keep polling
        }
      };
      codeGen = `// wait for element to be stable (geometry unchanged)\nawait driver.wait(async () => { const r1 = await el.getRect(); await new Promise(r => setTimeout(r, 100)); const r2 = await el.getRect(); return r1.x === r2.x && r1.y === r2.y && r1.width === r2.width && r1.height === r2.height; }, ${timeout});`;
      break;
    case 'attached':
      // Wait until element is attached to the DOM (not stale).
      // Selenium doesn't have until.elementIsAttached(), so we use
      // a custom condition that checks for StaleElementReferenceError.
      condition = async () => {
        try {
          await el.getTagName();
          return true;
        } catch (e: any) {
          if (e.name === 'StaleElementReferenceError') return false;
          throw e;
        }
      };
      codeGen = `// wait for element to be attached (not stale)\nawait driver.wait(async () => { try { await el.getTagName(); return true; } catch (e) { if (e.name === 'StaleElementReferenceError') return false; throw e; } }, ${timeout});`;
      break;
    default:
      return null;
  }

  await driver.wait(condition, timeout);
  return codeGen;
}

// ── Config command helpers ───────────────────────────────────────

/**
 * Get a config value by dot-path key (e.g. 'wait.timeout', 'timeouts.implicit').
 */
export function getConfigValue(config: SeCliConfig, key: string): { value: any; source: string } | null {
  const parts = key.split('.');
  let current: any = config;
  for (const p of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return null;
    current = current[p];
  }
  if (current === undefined) return null;
  return { value: current, source: 'file' };
}

/**
 * Set a config value in the config file and save it.
 */
export function setConfigValue(cwd: string, key: string, value: string): void {
  const configPath = path.join(cwd, '.se-cli.json');
  let config: any = {};

  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const parts = key.split('.');
  let current = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }

  // Try to parse as number, boolean, or keep as string
  let parsedValue: any = value;
  if (/^-?\d+$/.test(value)) parsedValue = parseInt(value);
  else if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;

  current[parts[parts.length - 1]] = parsedValue;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Generate a template config file.
 */
export function generateTemplateConfig(cwd: string): string {
  const configPath = path.join(cwd, '.se-cli.json');
  const template = {
    wait: {
      timeout: 5000,
      state: 'auto',
      retry: 0,
      retryInterval: 100,
    },
    timeouts: {
      implicit: 0,
      pageLoad: 30000,
      script: 30000,
    },
    perCommand: {
      click:    { wait: { state: 'visible+enabled' } },
      fill:     { wait: { state: 'visible+enabled' } },
      snapshot: { wait: { state: 'none' } },
      eval:     { wait: { state: 'none' }, scriptTimeout: 30000 },
    },
  };

  const content = JSON.stringify(template, null, 2) + '\n';
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, content, 'utf8');
  }
  return content;
}

/**
 * List all config items with their effective values and sources.
 */
export function listConfig(config: ResolvedConfig): string[] {
  const lines: string[] = [];
  const items: [string, any, string][] = [
    ['wait.timeout',       config.wait.timeout,       config.sources.timeout || 'default'],
    ['wait.state',         config.wait.state,         config.sources.state || 'default'],
    ['wait.retry',         config.wait.retry,         config.sources.retry || 'default'],
    ['wait.retryInterval', config.wait.retryInterval, config.sources.retryInterval || 'default'],
    ['timeouts.implicit', config.timeouts.implicit,  config.sources.implicit || 'default'],
    ['timeouts.pageLoad', config.timeouts.pageLoad,   config.sources.pageLoad || 'default'],
    ['timeouts.script',   config.timeouts.script,    config.sources.script || 'default'],
  ];

  for (const [key, value, source] of items) {
    lines.push(`${key}\t${value}\t(${source})`);
  }
  return lines;
}
