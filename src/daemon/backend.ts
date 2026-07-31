import { Response } from '../response';
import { parseArgs } from '../minimist';
import { tools } from './tools';
import {
  resolveConfig,
  applyTimeouts,
  waitForElementState,
  type ParsedFlags,
  type WaitConfig,
} from '../wait-config';

export async function callTool(
  driver: any,
  toolName: string,
  params: any,
  responseOpts: { raw: boolean; json: boolean },
  flags: ParsedFlags = {},
  cwd: string = process.cwd(),
): Promise<Response> {
  // Handle config commands locally (no driver needed)
  if (toolName === 'config_get' || toolName === 'config_set' ||
      toolName === 'config_list' || toolName === 'config_init') {
    return handleConfigCommand(toolName, params, responseOpts, cwd);
  }

  const handler = tools[toolName];
  if (!handler) {
    const r = new Response(responseOpts);
    r.addError(`Unknown tool: ${toolName}`);
    return r;
  }

  // Resolve the effective wait/retry/timeout configuration
  const commandName = toolName.replace('browser_', '');
  const config = resolveConfig(flags, cwd, process.env as any, commandName);

  // Apply timeout settings to the driver
  try {
    await applyTimeouts(driver, config.timeouts);
  } catch {
    // Some drivers may not support all timeout methods — ignore failures
  }

  // Pass resolved wait config to interactive tools via params._wait
  if (config.wait.state !== 'none' && config.wait.timeout > 0) {
    params._wait = {
      state: config.wait.state,
      timeout: config.wait.timeout,
    } as WaitConfig;
  }

  const response = new Response(responseOpts);

  // Retry logic: retry count > 0 or -1 (until timeout)
  if (config.wait.retry !== 0) {
    const maxRetries = config.wait.retry === -1 ? Infinity : config.wait.retry;
    const startTime = Date.now();
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // For retry=-1, stop when timeout expires
      if (config.wait.retry === -1 && Date.now() - startTime > config.wait.timeout) {
        break;
      }

      // Use a fresh response for each attempt to avoid duplicate results
      const retryResponse = new Response(responseOpts);
      try {
        await handler(driver, params, retryResponse);
        // Success — return the response
        try {
          await driver.switchTo().defaultContent();
        } catch {
          // Ignore
        }
        return retryResponse;
      } catch (e: any) {
        lastError = e;
        // Reset to top-level frame before retry
        try {
          await driver.switchTo().defaultContent();
        } catch {
          // Ignore
        }
        // If more retries remain, wait before retrying
        if (attempt < maxRetries) {
          if (config.wait.retry === -1 &&
              Date.now() - startTime > config.wait.timeout) {
            break;
          }
          await new Promise(r => setTimeout(r, config.wait.retryInterval));
        }
      }
    }
    // All retries exhausted — report the last error
    response.addError(lastError?.message || 'All retries exhausted');
    return response;
  }

  // No retry — single attempt
  try {
    await handler(driver, params, response);
  } finally {
    // Always reset to the top-level frame after a tool call so the
    // next command starts in the main document context. This is
    // essential for cross-frame refs: after clicking an element
    // inside an iframe (which calls driver.switchTo().frame()),
    // subsequent snapshot/find/eval commands must run in the main frame.
    try {
      await driver.switchTo().defaultContent();
    } catch {
      // Ignore — some drivers throw if there's no frame to switch back from.
    }
  }
  return response;
}

/**
 * Handle config commands locally without a driver.
 */
function handleConfigCommand(
  toolName: string,
  params: any,
  responseOpts: { raw: boolean; json: boolean },
  cwd: string,
): Response {
  const response = new Response(responseOpts);
  const {
    getConfigValue,
    setConfigValue,
    listConfig,
    generateTemplateConfig,
    loadConfigFile,
    resolveConfig,
  } = require('../wait-config');

  switch (toolName) {
    case 'config_get': {
      const fileConfig = loadConfigFile(cwd);
      if (!fileConfig) {
        response.addResult('(no config file found)');
        return response;
      }
      const result = getConfigValue(fileConfig, params.key);
      if (result) {
        response.addResult(String(result.value));
        response.addCode(`config get ${params.key}`);
      } else {
        response.addResult(`(not set: ${params.key})`);
      }
      return response;
    }
    case 'config_set': {
      setConfigValue(cwd, params.key, params.value);
      response.addResult(`Set ${params.key} = ${params.value}`);
      response.addCode(`config set ${params.key} ${params.value}`);
      return response;
    }
    case 'config_list': {
      const resolved = resolveConfig({}, cwd, process.env as any);
      const lines = listConfig(resolved);
      response.addResult(lines.join('\n'));
      response.addCode('config list');
      return response;
    }
    case 'config_init': {
      const content = generateTemplateConfig(cwd);
      response.addResult('Generated .se-cli.json');
      response.addCode('config init');
      return response;
    }
    default:
      response.addError(`Unknown config command: ${toolName}`);
      return response;
  }
}

export function parseCommand(args: string[]): { toolName: string; toolParams: any; flags: ParsedFlags } {
  const [cmd, ...rest] = args;

  // Parse flags from rest using minimist
  // Include wait/retry flags in the known options
  const parsed = parseArgs(rest, {
    boolean: ['submit', 'no-wait'],
    string: [
      'filename', 'depth', 'regex',
      // v0.4 wait/retry flags
      'timeout', 'wait', 'retry', 'retry-interval',
      'implicit-wait', 'page-load-timeout', 'script-timeout',
    ],
    alias: {},
  });
  const positional = parsed._;

  // Extract wait/retry flags for config resolution
  const flags: ParsedFlags = {};
  if (parsed.timeout !== undefined) flags.timeout = String(parsed.timeout);
  if (parsed.wait !== undefined) flags.wait = String(parsed.wait);
  if (parsed.retry !== undefined) flags.retry = String(parsed.retry);
  if (parsed['retry-interval'] !== undefined) flags['retry-interval'] = String(parsed['retry-interval']);
  if (parsed['implicit-wait'] !== undefined) flags['implicit-wait'] = String(parsed['implicit-wait']);
  if (parsed['page-load-timeout'] !== undefined) flags['page-load-timeout'] = String(parsed['page-load-timeout']);
  if (parsed['script-timeout'] !== undefined) flags['script-timeout'] = String(parsed['script-timeout']);
  if (parsed['no-wait'] !== undefined) flags['no-wait'] = true;

  const commands: Record<string, () => { toolName: string; toolParams: any }> = {
    'goto': () => ({ toolName: 'browser_goto', toolParams: { url: positional[0] } }),
    'go-back': () => ({ toolName: 'browser_go_back', toolParams: {} }),
    'go-forward': () => ({ toolName: 'browser_go_forward', toolParams: {} }),
    'reload': () => ({ toolName: 'browser_reload', toolParams: {} }),
    'title': () => ({ toolName: 'browser_title', toolParams: {} }),
    'url': () => ({ toolName: 'browser_url', toolParams: {} }),
    'click': () => ({ toolName: 'browser_click', toolParams: { target: positional[0] } }),
    'fill': () => ({ toolName: 'browser_fill', toolParams: { target: positional[0], value: positional[1], submit: parsed.submit } }),
    'type': () => ({ toolName: 'browser_type', toolParams: { value: positional[0] } }),
    'press': () => ({ toolName: 'browser_press', toolParams: { key: positional[0] } }),
    'select': () => ({ toolName: 'browser_select', toolParams: { target: positional[0], value: positional[1] } }),
    'check': () => ({ toolName: 'browser_check', toolParams: { target: positional[0] } }),
    'uncheck': () => ({ toolName: 'browser_uncheck', toolParams: { target: positional[0] } }),
    'snapshot': () => ({ toolName: 'browser_snapshot', toolParams: { target: positional[0], depth: parsed.depth ? parseInt(parsed.depth) : undefined, filename: parsed.filename } }),
    'find': () => ({ toolName: 'browser_find', toolParams: { text: positional[0], regex: parsed.regex } }),
    'screenshot': () => ({ toolName: 'browser_screenshot', toolParams: { target: positional[0], filename: parsed.filename } }),
    'eval': () => ({ toolName: 'browser_eval', toolParams: { script: positional[0], target: positional[1] } }),
    'cookie-list': () => ({ toolName: 'browser_cookie_list', toolParams: {} }),
    'cookie-get': () => ({ toolName: 'browser_cookie_get', toolParams: { name: positional[0] } }),
    'cookie-set': () => ({ toolName: 'browser_cookie_set', toolParams: { name: positional[0], value: positional[1] } }),
    'cookie-delete': () => ({ toolName: 'browser_cookie_delete', toolParams: { name: positional[0] } }),
    'localstorage-get': () => ({ toolName: 'browser_localstorage_get', toolParams: { key: positional[0] } }),
    'localstorage-set': () => ({ toolName: 'browser_localstorage_set', toolParams: { key: positional[0], value: positional[1] } }),
    'localstorage-delete': () => ({ toolName: 'browser_localstorage_delete', toolParams: { key: positional[0] } }),
    'localstorage-list': () => ({ toolName: 'browser_localstorage_list', toolParams: {} }),
    'sessionstorage-get': () => ({ toolName: 'browser_sessionstorage_get', toolParams: { key: positional[0] } }),
    'sessionstorage-set': () => ({ toolName: 'browser_sessionstorage_set', toolParams: { key: positional[0], value: positional[1] } }),
    'sessionstorage-delete': () => ({ toolName: 'browser_sessionstorage_delete', toolParams: { key: positional[0] } }),
    'sessionstorage-list': () => ({ toolName: 'browser_sessionstorage_list', toolParams: {} }),
    'tab-list': () => ({ toolName: 'browser_tab_list', toolParams: {} }),
    'tab-new': () => ({ toolName: 'browser_tab_new', toolParams: { url: positional[0] } }),
    'tab-close': () => ({ toolName: 'browser_tab_close', toolParams: {} }),
    'tab-select': () => ({ toolName: 'browser_tab_select', toolParams: { index: positional[0] ? parseInt(positional[0]) : 0 } }),
    'state-save': () => ({ toolName: 'browser_state_save', toolParams: { filename: parsed.filename } }),
    'state-load': () => ({ toolName: 'browser_state_load', toolParams: { filename: parsed.filename } }),
    // v0.4 config commands
    'config': () => {
      const subCmd = positional[0];
      if (subCmd === 'get') return { toolName: 'config_get', toolParams: { key: positional[1] } };
      if (subCmd === 'set') return { toolName: 'config_set', toolParams: { key: positional[1], value: positional[2] } };
      if (subCmd === 'list') return { toolName: 'config_list', toolParams: {} };
      if (subCmd === 'init') return { toolName: 'config_init', toolParams: {} };
      throw new Error(`Unknown config subcommand: ${subCmd}. Supported: get, set, list, init`);
    },
  };
  const factory = commands[cmd];
  if (!factory) throw new Error(`Unknown command: ${cmd}`);
  const result = factory();
  return { ...result, flags };
}
