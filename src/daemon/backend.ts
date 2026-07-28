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
  };
  const factory = commands[cmd];
  if (!factory) throw new Error(`Unknown command: ${cmd}`);
  return factory();
}
