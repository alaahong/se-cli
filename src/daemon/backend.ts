import { Response } from '../response';
import { parseArgs } from '../minimist';
import { tools } from './tools';

export async function callTool(
  driver: any,
  toolName: string,
  params: any,
  responseOpts: { raw: boolean; json: boolean }
): Promise<Response> {
  const handler = tools[toolName];
  if (!handler) {
    const r = new Response(responseOpts);
    r.addError(`Unknown tool: ${toolName}`);
    return r;
  }
  const response = new Response(responseOpts);
  await handler(driver, params, response);
  return response;
}

export function parseCommand(args: string[]): { toolName: string; toolParams: any } {
  const [cmd, ...rest] = args;

  // Parse flags from rest using minimist
  const parsed = parseArgs(rest, {
    boolean: ['submit'],
    string: ['filename', 'depth', 'regex'],
    alias: {},
  });
  const positional = parsed._;

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
  };
  const factory = commands[cmd];
  if (!factory) throw new Error(`Unknown command: ${cmd}`);
  return factory();
}
