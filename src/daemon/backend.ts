import { Response } from '../response';
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
  const [cmd, ...rest] = args as any;
  const commands: Record<string, () => { toolName: string; toolParams: any }> = {
    'goto': () => ({ toolName: 'browser_goto', toolParams: { url: rest[0] } }),
    'go-back': () => ({ toolName: 'browser_go_back', toolParams: {} }),
    'go-forward': () => ({ toolName: 'browser_go_forward', toolParams: {} }),
    'reload': () => ({ toolName: 'browser_reload', toolParams: {} }),
    'title': () => ({ toolName: 'browser_title', toolParams: {} }),
    'url': () => ({ toolName: 'browser_url', toolParams: {} }),
    'click': () => ({ toolName: 'browser_click', toolParams: { target: rest[0] } }),
    'fill': () => ({ toolName: 'browser_fill', toolParams: { target: rest[0], value: rest[1] } }),
    'type': () => ({ toolName: 'browser_type', toolParams: { value: rest[0] } }),
    'press': () => ({ toolName: 'browser_press', toolParams: { key: rest[0] } }),
    'select': () => ({ toolName: 'browser_select', toolParams: { target: rest[0], value: rest[1] } }),
    'check': () => ({ toolName: 'browser_check', toolParams: { target: rest[0] } }),
    'uncheck': () => ({ toolName: 'browser_uncheck', toolParams: { target: rest[0] } }),
    'snapshot': () => ({ toolName: 'browser_snapshot', toolParams: { target: rest[0], depth: rest.depth, filename: rest.filename } }),
    'find': () => ({ toolName: 'browser_find', toolParams: { text: rest[0], regex: rest.regex } }),
    'screenshot': () => ({ toolName: 'browser_screenshot', toolParams: { target: rest[0], filename: rest.filename } }),
    'eval': () => ({ toolName: 'browser_eval', toolParams: { script: rest[0], target: rest[1] } }),
  };
  const factory = commands[cmd];
  if (!factory) throw new Error(`Unknown command: ${cmd}`);
  return factory();
}
