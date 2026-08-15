import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapToolToCliArgs, toolDefinitions, buildOpenOptions, type ToolDef } from '../../src/mcp-server';

vi.mock('../../src/detect-browser', () => ({
  detectBrowser: vi.fn(),
}));
import { detectBrowser } from '../../src/detect-browser';

describe('MCP Server — Tool Definitions', () => {
  it('should have at least 40 tools', () => {
    expect(toolDefinitions.length).toBeGreaterThanOrEqual(40);
  });

  it('every tool should have name, description, and inputSchema', () => {
    for (const tool of toolDefinitions) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('tool names should be unique', () => {
    const names = toolDefinitions.map(t => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('tool names should follow browser_* convention', () => {
    for (const tool of toolDefinitions) {
      expect(tool.name).toMatch(/^browser_/);
    }
  });

  it('every tool should have a description of at least 10 chars', () => {
    for (const tool of toolDefinitions) {
      expect(tool.description.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('tools with required fields should list them in inputSchema', () => {
    for (const tool of toolDefinitions) {
      if (tool.inputSchema.required) {
        for (const req of tool.inputSchema.required) {
          expect(tool.inputSchema.properties[req]).toBeDefined();
        }
      }
    }
  });

  it('should include core navigation tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_navigate');
    expect(names).toContain('browser_go_back');
    expect(names).toContain('browser_go_forward');
    expect(names).toContain('browser_reload');
    expect(names).toContain('browser_get_title');
    expect(names).toContain('browser_get_url');
  });

  it('should include core interaction tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_click');
    expect(names).toContain('browser_fill');
    expect(names).toContain('browser_type');
    expect(names).toContain('browser_press');
    expect(names).toContain('browser_select');
    expect(names).toContain('browser_check');
    expect(names).toContain('browser_uncheck');
  });

  it('should include snapshot and eval tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_snapshot');
    expect(names).toContain('browser_find');
    expect(names).toContain('browser_screenshot');
    expect(names).toContain('browser_eval');
  });

  it('should include v0.13 preload tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_preload_add');
    expect(names).toContain('browser_preload_remove');
    expect(names).toContain('browser_preload_list');
    const add = toolDefinitions.find(t => t.name === 'browser_preload_add')!;
    expect(add.inputSchema.required).toContain('script');
    const remove = toolDefinitions.find(t => t.name === 'browser_preload_remove')!;
    expect(remove.inputSchema.required).toContain('id');
  });

  it('should include session management tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_open');
    expect(names).toContain('browser_close');
    expect(names).toContain('browser_list_sessions');
    expect(names).toContain('browser_close_all');
  });

  it('should include assertion tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_expect');
  });

  it('should include network & debugging tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_highlight');
    expect(names).toContain('browser_console');
    expect(names).toContain('browser_requests');
    expect(names).toContain('browser_request_detail');
    expect(names).toContain('browser_route');
    expect(names).toContain('browser_route_list');
    expect(names).toContain('browser_unroute');
  });

  it('should include advanced input tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_hover');
    expect(names).toContain('browser_dblclick');
    expect(names).toContain('browser_drag');
    expect(names).toContain('browser_dialog_accept');
    expect(names).toContain('browser_dialog_dismiss');
    expect(names).toContain('browser_upload');
    expect(names).toContain('browser_resize');
    expect(names).toContain('browser_keydown');
    expect(names).toContain('browser_keyup');
    expect(names).toContain('browser_mousemove');
    expect(names).toContain('browser_mousedown');
    expect(names).toContain('browser_mouseup');
    expect(names).toContain('browser_mousewheel');
    expect(names).toContain('browser_actions_chain');
  });

  it('should include storage and tab tools', () => {
    const names = toolDefinitions.map(t => t.name);
    expect(names).toContain('browser_cookie_list');
    expect(names).toContain('browser_cookie_get');
    expect(names).toContain('browser_cookie_set');
    expect(names).toContain('browser_cookie_delete');
    // v0.9: localStorage/sessionStorage tools must be exposed (spec claims all CLI tools)
    expect(names).toContain('browser_localstorage_list');
    expect(names).toContain('browser_localstorage_get');
    expect(names).toContain('browser_localstorage_set');
    expect(names).toContain('browser_localstorage_delete');
    expect(names).toContain('browser_sessionstorage_list');
    expect(names).toContain('browser_sessionstorage_get');
    expect(names).toContain('browser_sessionstorage_set');
    expect(names).toContain('browser_sessionstorage_delete');
    expect(names).toContain('browser_state_save');
    expect(names).toContain('browser_state_load');
    expect(names).toContain('browser_tab_list');
    expect(names).toContain('browser_tab_new');
    expect(names).toContain('browser_tab_close');
    expect(names).toContain('browser_tab_select');
  });

  it('browser_navigate should require url', () => {
    const tool = toolDefinitions.find(t => t.name === 'browser_navigate');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('url');
  });

  it('browser_click should require target', () => {
    const tool = toolDefinitions.find(t => t.name === 'browser_click');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('target');
  });

  it('browser_fill should require target and value', () => {
    const tool = toolDefinitions.find(t => t.name === 'browser_fill');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('target');
    expect(tool!.inputSchema.required).toContain('value');
  });

  it('browser_expect should require assertion', () => {
    const tool = toolDefinitions.find(t => t.name === 'browser_expect');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('assertion');
  });

  it('browser_open should have browser enum', () => {
    const tool = toolDefinitions.find(t => t.name === 'browser_open');
    expect(tool).toBeDefined();
    const browserProp = tool!.inputSchema.properties.browser;
    expect(browserProp).toBeDefined();
    expect(browserProp.enum).toEqual(['chrome', 'edge', 'firefox']);
  });
});

describe('MCP Server — mapToolToCliArgs', () => {

  // ── Navigation ──
  it('maps browser_navigate to goto', () => {
    expect(mapToolToCliArgs('browser_navigate', { url: 'https://example.com' }))
      .toEqual(['goto', 'https://example.com']);
  });

  it('maps browser_navigate with session', () => {
    expect(mapToolToCliArgs('browser_navigate', { url: 'https://example.com', session: 'test' }))
      .toEqual(['goto', 'https://example.com', '-s', 'test']);
  });

  it('maps browser_go_back', () => {
    expect(mapToolToCliArgs('browser_go_back', {})).toEqual(['go-back']);
  });

  it('maps browser_go_forward', () => {
    expect(mapToolToCliArgs('browser_go_forward', {})).toEqual(['go-forward']);
  });

  it('maps browser_reload', () => {
    expect(mapToolToCliArgs('browser_reload', {})).toEqual(['reload']);
  });

  it('maps browser_get_title', () => {
    expect(mapToolToCliArgs('browser_get_title', {})).toEqual(['title']);
  });

  it('maps browser_get_url', () => {
    expect(mapToolToCliArgs('browser_get_url', {})).toEqual(['url']);
  });

  // ── Interaction ──
  it('maps browser_click', () => {
    expect(mapToolToCliArgs('browser_click', { target: 'e1' }))
      .toEqual(['click', 'e1']);
  });

  it('maps browser_fill', () => {
    expect(mapToolToCliArgs('browser_fill', { target: 'e1', value: 'hello' }))
      .toEqual(['fill', 'e1', 'hello']);
  });

  it('maps browser_fill with --submit', () => {
    expect(mapToolToCliArgs('browser_fill', { target: 'e1', value: 'hello', submit: true }))
      .toEqual(['fill', 'e1', 'hello', '--submit']);
  });

  it('maps browser_type', () => {
    expect(mapToolToCliArgs('browser_type', { value: 'text' }))
      .toEqual(['type', 'text']);
  });

  it('maps browser_press', () => {
    expect(mapToolToCliArgs('browser_press', { key: 'Enter' }))
      .toEqual(['press', 'Enter']);
  });

  it('maps browser_select', () => {
    expect(mapToolToCliArgs('browser_select', { target: 'e1', value: 'option1' }))
      .toEqual(['select', 'e1', 'option1']);
  });

  it('maps browser_check', () => {
    expect(mapToolToCliArgs('browser_check', { target: 'e1' }))
      .toEqual(['check', 'e1']);
  });

  it('maps browser_uncheck', () => {
    expect(mapToolToCliArgs('browser_uncheck', { target: 'e1' }))
      .toEqual(['uncheck', 'e1']);
  });

  it('maps browser_hover', () => {
    expect(mapToolToCliArgs('browser_hover', { target: 'e1' }))
      .toEqual(['hover', 'e1']);
  });

  it('maps browser_dblclick', () => {
    expect(mapToolToCliArgs('browser_dblclick', { target: 'e1' }))
      .toEqual(['dblclick', 'e1']);
  });

  it('maps browser_drag', () => {
    expect(mapToolToCliArgs('browser_drag', { start: 'e1', end: 'e2' }))
      .toEqual(['drag', 'e1', 'e2']);
  });

  // ── Snapshot & Search ──
  it('maps browser_snapshot without target', () => {
    expect(mapToolToCliArgs('browser_snapshot', {})).toEqual(['snapshot']);
  });

  it('maps browser_snapshot with target', () => {
    expect(mapToolToCliArgs('browser_snapshot', { target: 'e1' }))
      .toEqual(['snapshot', 'e1']);
  });

  it('maps browser_snapshot with depth', () => {
    expect(mapToolToCliArgs('browser_snapshot', { depth: 3 }))
      .toEqual(['snapshot', '--depth=3']);
  });

  it('maps browser_snapshot with target and depth', () => {
    expect(mapToolToCliArgs('browser_snapshot', { target: 'e1', depth: 3 }))
      .toEqual(['snapshot', 'e1', '--depth=3']);
  });

  it('maps browser_find with text', () => {
    expect(mapToolToCliArgs('browser_find', { text: 'Submit' }))
      .toEqual(['find', 'Submit']);
  });

  it('maps browser_find with regex', () => {
    expect(mapToolToCliArgs('browser_find', { regex: 'sub.*' }))
      .toEqual(['find', '--regex', 'sub.*']);
  });

  it('maps browser_screenshot without target', () => {
    expect(mapToolToCliArgs('browser_screenshot', {})).toEqual(['screenshot']);
  });

  it('maps browser_screenshot with filename', () => {
    expect(mapToolToCliArgs('browser_screenshot', { filename: 'shot.png' }))
      .toEqual(['screenshot', '--filename=shot.png']);
  });

  it('maps browser_eval without target', () => {
    expect(mapToolToCliArgs('browser_eval', { script: 'return 1+1' }))
      .toEqual(['eval', 'return 1+1']);
  });

  it('maps browser_eval with target', () => {
    expect(mapToolToCliArgs('browser_eval', { script: 'return el.textContent', target: 'e1' }))
      .toEqual(['eval', 'return el.textContent', 'e1']);
  });

  // ── Tab Management ──
  it('maps browser_tab_list', () => {
    expect(mapToolToCliArgs('browser_tab_list', {})).toEqual(['tab-list']);
  });

  it('maps browser_tab_new without url', () => {
    expect(mapToolToCliArgs('browser_tab_new', {})).toEqual(['tab-new']);
  });

  it('maps browser_tab_new with url', () => {
    expect(mapToolToCliArgs('browser_tab_new', { url: 'https://example.com' }))
      .toEqual(['tab-new', 'https://example.com']);
  });

  it('maps browser_tab_close', () => {
    expect(mapToolToCliArgs('browser_tab_close', {})).toEqual(['tab-close']);
  });

  it('maps browser_tab_select', () => {
    expect(mapToolToCliArgs('browser_tab_select', { index: 2 }))
      .toEqual(['tab-select', '2']);
  });

  // ── Storage & State ──
  it('maps browser_cookie_list', () => {
    expect(mapToolToCliArgs('browser_cookie_list', {})).toEqual(['cookie-list']);
  });

  it('maps browser_cookie_get', () => {
    expect(mapToolToCliArgs('browser_cookie_get', { name: 'session' }))
      .toEqual(['cookie-get', 'session']);
  });

  it('maps browser_cookie_set', () => {
    expect(mapToolToCliArgs('browser_cookie_set', { name: 'foo', value: 'bar' }))
      .toEqual(['cookie-set', 'foo', 'bar']);
  });

  it('maps browser_cookie_delete with name', () => {
    expect(mapToolToCliArgs('browser_cookie_delete', { name: 'foo' }))
      .toEqual(['cookie-delete', 'foo']);
  });

  it('maps browser_cookie_delete without name', () => {
    expect(mapToolToCliArgs('browser_cookie_delete', {}))
      .toEqual(['cookie-delete']);
  });

  it('maps browser_state_save without filename', () => {
    expect(mapToolToCliArgs('browser_state_save', {})).toEqual(['state-save']);
  });

  it('maps browser_state_save with filename', () => {
    expect(mapToolToCliArgs('browser_state_save', { filename: 'state.json' }))
      .toEqual(['state-save', '--filename=state.json']);
  });

  it('maps browser_state_load', () => {
    expect(mapToolToCliArgs('browser_state_load', { filename: 'state.json' }))
      .toEqual(['state-load', '--filename=state.json']);
  });

  // ── localStorage / sessionStorage (v0.9) ──
  it('maps browser_localstorage_list', () => {
    expect(mapToolToCliArgs('browser_localstorage_list', {}))
      .toEqual(['localstorage-list']);
  });

  it('maps browser_localstorage_get', () => {
    expect(mapToolToCliArgs('browser_localstorage_get', { key: 'foo' }))
      .toEqual(['localstorage-get', 'foo']);
  });

  it('maps browser_localstorage_set', () => {
    expect(mapToolToCliArgs('browser_localstorage_set', { key: 'foo', value: 'bar' }))
      .toEqual(['localstorage-set', 'foo', 'bar']);
  });

  it('maps browser_localstorage_delete with key', () => {
    expect(mapToolToCliArgs('browser_localstorage_delete', { key: 'foo' }))
      .toEqual(['localstorage-delete', 'foo']);
  });

  it('maps browser_localstorage_delete without key (clear all)', () => {
    expect(mapToolToCliArgs('browser_localstorage_delete', {}))
      .toEqual(['localstorage-delete']);
  });

  it('maps browser_sessionstorage_list', () => {
    expect(mapToolToCliArgs('browser_sessionstorage_list', {}))
      .toEqual(['sessionstorage-list']);
  });

  it('maps browser_sessionstorage_get', () => {
    expect(mapToolToCliArgs('browser_sessionstorage_get', { key: 'foo' }))
      .toEqual(['sessionstorage-get', 'foo']);
  });

  it('maps browser_sessionstorage_set', () => {
    expect(mapToolToCliArgs('browser_sessionstorage_set', { key: 'foo', value: 'bar' }))
      .toEqual(['sessionstorage-set', 'foo', 'bar']);
  });

  it('maps browser_sessionstorage_delete', () => {
    expect(mapToolToCliArgs('browser_sessionstorage_delete', { key: 'foo' }))
      .toEqual(['sessionstorage-delete', 'foo']);
  });

  // ── Advanced Input ──
  it('maps browser_dialog_accept without text', () => {
    expect(mapToolToCliArgs('browser_dialog_accept', {}))
      .toEqual(['dialog-accept']);
  });

  it('maps browser_dialog_accept with text', () => {
    expect(mapToolToCliArgs('browser_dialog_accept', { text: 'hello' }))
      .toEqual(['dialog-accept', 'hello']);
  });

  it('maps browser_dialog_dismiss', () => {
    expect(mapToolToCliArgs('browser_dialog_dismiss', {}))
      .toEqual(['dialog-dismiss']);
  });

  it('maps browser_upload', () => {
    expect(mapToolToCliArgs('browser_upload', { target: 'e1', file: '/path/file.txt' }))
      .toEqual(['upload', 'e1', '/path/file.txt']);
  });

  it('maps browser_resize', () => {
    expect(mapToolToCliArgs('browser_resize', { width: 800, height: 600 }))
      .toEqual(['resize', '800', '600']);
  });

  it('maps browser_keydown', () => {
    expect(mapToolToCliArgs('browser_keydown', { key: 'Shift' }))
      .toEqual(['keydown', 'Shift']);
  });

  it('maps browser_keyup', () => {
    expect(mapToolToCliArgs('browser_keyup', { key: 'Shift' }))
      .toEqual(['keyup', 'Shift']);
  });

  it('maps browser_mousemove', () => {
    expect(mapToolToCliArgs('browser_mousemove', { x: 100, y: 200 }))
      .toEqual(['mousemove', '100', '200']);
  });

  it('maps browser_mousedown with button', () => {
    expect(mapToolToCliArgs('browser_mousedown', { button: 'right' }))
      .toEqual(['mousedown', 'right']);
  });

  it('maps browser_mousedown without button', () => {
    expect(mapToolToCliArgs('browser_mousedown', {}))
      .toEqual(['mousedown']);
  });

  it('maps browser_mouseup', () => {
    expect(mapToolToCliArgs('browser_mouseup', { button: 'left' }))
      .toEqual(['mouseup', 'left']);
  });

  it('maps browser_mousewheel', () => {
    expect(mapToolToCliArgs('browser_mousewheel', { dx: 0, dy: 100 }))
      .toEqual(['mousewheel', '0', '100']);
  });

  it('maps browser_actions_chain', () => {
    const actions = JSON.stringify([{ type: 'click', target: 'e1' }]);
    expect(mapToolToCliArgs('browser_actions_chain', { actions }))
      .toEqual(['actions-chain', actions]);
  });

  // ── Assertions ──
  it('maps browser_expect visible', () => {
    expect(mapToolToCliArgs('browser_expect', { target: 'e1', assertion: 'visible' }))
      .toEqual(['expect', 'e1', 'visible']);
  });

  it('maps browser_expect text with expected value', () => {
    expect(mapToolToCliArgs('browser_expect', { target: 'e1', assertion: 'text', expected: 'Hello' }))
      .toEqual(['expect', 'e1', 'text', 'Hello']);
  });

  it('maps browser_expect with --not flag', () => {
    expect(mapToolToCliArgs('browser_expect', { target: 'e1', assertion: 'visible', not: true }))
      .toEqual(['expect', 'e1', 'visible', '--not']);
  });

  it('maps browser_expect with --exact flag', () => {
    expect(mapToolToCliArgs('browser_expect', { target: 'e1', assertion: 'text', expected: 'Hello', exact: true }))
      .toEqual(['expect', 'e1', 'text', 'Hello', '--exact']);
  });

  it('maps browser_expect with --timeout', () => {
    expect(mapToolToCliArgs('browser_expect', { target: 'e1', assertion: 'visible', timeout: 10000 }))
      .toEqual(['expect', 'e1', 'visible', '--timeout', '10000']);
  });

  it('maps browser_expect title assertion (no target)', () => {
    expect(mapToolToCliArgs('browser_expect', { assertion: 'title', expected: 'My Page' }))
      .toEqual(['expect', 'title', 'My Page']);
  });

  it('maps browser_expect attribute assertion', () => {
    expect(mapToolToCliArgs('browser_expect', {
      target: 'e1', assertion: 'attribute', expected: 'href', attributeValue: 'https://example.com'
    })).toEqual(['expect', 'e1', 'attribute', 'href', 'https://example.com']);
  });

  // ── Network & Debugging ──
  it('maps browser_highlight without target', () => {
    expect(mapToolToCliArgs('browser_highlight', {})).toEqual(['highlight']);
  });

  it('maps browser_highlight with target and style', () => {
    expect(mapToolToCliArgs('browser_highlight', { target: 'e1', style: '2px solid blue' }))
      .toEqual(['highlight', 'e1', '--style=2px solid blue']);
  });

  it('maps browser_highlight --hide --all', () => {
    expect(mapToolToCliArgs('browser_highlight', { hide: true, all: true }))
      .toEqual(['highlight', '--hide', '--all']);
  });

  it('maps browser_console without level', () => {
    expect(mapToolToCliArgs('browser_console', {})).toEqual(['console']);
  });

  it('maps browser_console with level and since', () => {
    expect(mapToolToCliArgs('browser_console', { level: 'error', since: '5m' }))
      .toEqual(['console', 'error', '--since=5m']);
  });

  it('maps browser_console with --clear', () => {
    expect(mapToolToCliArgs('browser_console', { clear: true }))
      .toEqual(['console', '--clear']);
  });

  it('maps browser_requests with filters', () => {
    expect(mapToolToCliArgs('browser_requests', { filter: 'api', status: '200', method: 'GET' }))
      .toEqual(['requests', '--filter=api', '--status=200', '--method=GET']);
  });

  it('maps browser_requests with --clear', () => {
    expect(mapToolToCliArgs('browser_requests', { clear: true }))
      .toEqual(['requests', '--clear']);
  });

  it('maps browser_request_detail', () => {
    expect(mapToolToCliArgs('browser_request_detail', { index: 3 }))
      .toEqual(['request', '3']);
  });

  it('maps browser_route', () => {
    expect(mapToolToCliArgs('browser_route', { pattern: '**/api/**', status: '404' }))
      .toEqual(['route', '**/api/**', '--status=404']);
  });

  it('maps browser_route with body and headers', () => {
    expect(mapToolToCliArgs('browser_route', {
      pattern: '**/api/**', status: '200', body: '{"ok":true}', headers: '{"Content-Type":"application/json"}'
    })).toEqual(['route', '**/api/**', '--status=200', '--body={"ok":true}', '--headers={"Content-Type":"application/json"}']);
  });

  it('maps browser_route_list', () => {
    expect(mapToolToCliArgs('browser_route_list', {})).toEqual(['route-list']);
  });

  it('maps browser_unroute by index', () => {
    expect(mapToolToCliArgs('browser_unroute', { index: 1 }))
      .toEqual(['unroute', '1']);
  });

  it('maps browser_unroute --all', () => {
    expect(mapToolToCliArgs('browser_unroute', { all: true }))
      .toEqual(['unroute', '--all']);
  });

  // ── v0.8: Device & Environment Emulation ──
  it('maps browser_device by name', () => {
    expect(mapToolToCliArgs('browser_device', { name: 'iPhone 13' }))
      .toEqual(['device', 'iPhone 13']);
  });

  it('maps browser_device without a name (show state)', () => {
    expect(mapToolToCliArgs('browser_device', {})).toEqual(['device']);
  });

  it('maps browser_device_list', () => {
    expect(mapToolToCliArgs('browser_device_list', {})).toEqual(['device-list']);
  });

  it('maps browser_emulate with offline', () => {
    expect(mapToolToCliArgs('browser_emulate', { offline: true }))
      .toEqual(['emulate', '--offline']);
  });

  it('maps browser_emulate with explicit offline=false', () => {
    expect(mapToolToCliArgs('browser_emulate', { offline: false }))
      .toEqual(['emulate', '--offline=false']);
  });

  it('maps browser_emulate with throttle network and CPU', () => {
    expect(mapToolToCliArgs('browser_emulate', { throttleNetwork: 'slow3g', throttleCpu: 4 }))
      .toEqual(['emulate', '--throttle-network=slow3g', '--throttle-cpu=4']);
  });

  it('maps browser_emulate reset', () => {
    expect(mapToolToCliArgs('browser_emulate', { reset: true }))
      .toEqual(['emulate', '--reset']);
  });

  // ── v0.13: preload ──
  it('maps browser_preload_add to preload add --script', () => {
    expect(mapToolToCliArgs('browser_preload_add', { script: 'window.x = 1' }))
      .toEqual(['preload', 'add', '--script=window.x = 1']);
  });

  it('maps browser_preload_add with context', () => {
    expect(mapToolToCliArgs('browser_preload_add', { script: 'x', context: 'ctx-1' }))
      .toEqual(['preload', 'add', '--script=x', '--context=ctx-1']);
  });

  it('maps browser_preload_remove to preload remove --id', () => {
    expect(mapToolToCliArgs('browser_preload_remove', { id: 'preload-1' }))
      .toEqual(['preload', 'remove', '--id=preload-1']);
  });

  it('maps browser_preload_list to preload list', () => {
    expect(mapToolToCliArgs('browser_preload_list', {}))
      .toEqual(['preload', 'list']);
  });

  // ── Session Management ──
  it('maps browser_open to empty array (handled separately)', () => {
    expect(mapToolToCliArgs('browser_open', {})).toEqual([]);
  });

  it('maps browser_close to empty array', () => {
    expect(mapToolToCliArgs('browser_close', {})).toEqual([]);
  });

  it('maps browser_list_sessions to empty array', () => {
    expect(mapToolToCliArgs('browser_list_sessions', {})).toEqual([]);
  });

  it('maps browser_close_all to empty array', () => {
    expect(mapToolToCliArgs('browser_close_all', {})).toEqual([]);
  });

  // ── Session flag propagation ──
  it('propagates session flag for navigation', () => {
    expect(mapToolToCliArgs('browser_navigate', { url: 'https://x.com', session: 'mySession' }))
      .toEqual(['goto', 'https://x.com', '-s', 'mySession']);
  });

  it('propagates session flag for interaction', () => {
    expect(mapToolToCliArgs('browser_click', { target: 'e1', session: 'mySession' }))
      .toEqual(['click', 'e1', '-s', 'mySession']);
  });

  it('propagates session flag for snapshot', () => {
    expect(mapToolToCliArgs('browser_snapshot', { session: 'mySession' }))
      .toEqual(['snapshot', '-s', 'mySession']);
  });

  // ── Edge Cases ──
  it('returns null for unknown tool', () => {
    expect(mapToolToCliArgs('unknown_tool', {})).toBeNull();
  });

  it('returns null for undefined tool', () => {
    expect(mapToolToCliArgs('undefined', {})).toBeNull();
  });

  it('returns null for empty string tool', () => {
    expect(mapToolToCliArgs('', {})).toBeNull();
  });

  it('handles empty args object', () => {
    expect(mapToolToCliArgs('browser_snapshot', {})).toEqual(['snapshot']);
    expect(mapToolToCliArgs('browser_go_back', {})).toEqual(['go-back']);
    expect(mapToolToCliArgs('browser_tab_list', {})).toEqual(['tab-list']);
  });
});

describe('MCP Server — buildOpenOptions', () => {
  beforeEach(() => {
    vi.mocked(detectBrowser).mockReset();
  });

  it('uses the given browser when provided', () => {
    const { opts, error } = buildOpenOptions({ browser: 'firefox' }, '/ws', 's1');
    expect(error).toBeUndefined();
    expect(opts).toEqual({ browserName: 'firefox' });
    expect(detectBrowser).not.toHaveBeenCalled();
  });

  it('auto-detects the browser when browser is missing', () => {
    vi.mocked(detectBrowser).mockReturnValue('edge');
    const { opts, error } = buildOpenOptions({}, '/ws', 's1');
    expect(error).toBeUndefined();
    expect(opts.browserName).toBe('edge');
    expect(detectBrowser).toHaveBeenCalledTimes(1);
  });

  it('returns an error message when no browser is detected', () => {
    vi.mocked(detectBrowser).mockReturnValue(null);
    const { opts, error } = buildOpenOptions({}, '/ws', 's1');
    expect(opts).toEqual({});
    expect(error).toContain('No browser detected');
  });

  it('does not auto-detect when cdp is given', () => {
    const { opts, error } = buildOpenOptions({ cdp: 'http://localhost:9222' }, '/ws', 's1');
    expect(error).toBeUndefined();
    expect(opts).toEqual({ cdpEndpoint: 'http://localhost:9222' });
    expect(detectBrowser).not.toHaveBeenCalled();
  });

  it('propagates headed, profile, and persistent flags', () => {
    vi.mocked(detectBrowser).mockReturnValue('chrome');
    const { opts } = buildOpenOptions({ headed: true, profile: '/tmp/p' }, '/ws', 's1');
    expect(opts.headed).toBe(true);
    expect(opts.profilePath).toBe('/tmp/p');

    const persistent = buildOpenOptions({ persistent: true }, '/ws', 'mySession');
    expect(persistent.error).toBeUndefined();
    expect(persistent.opts.persistent).toBe(true);
    expect(persistent.opts.profilePath).toContain('profiles');
    expect(persistent.opts.profilePath).toContain('mySession');
  });
});

// ===========================================================================
// MCP Server — request handling (browser_open / browser_close semantics)
// ===========================================================================

const { mockRl } = vi.hoisted(() => ({
  mockRl: { on: vi.fn(), close: vi.fn() },
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => mockRl),
}));

vi.mock('../../src/session', () => {
  return {
    Session: class MockSession {
      stop = vi.fn(async () => {});
      run = vi.fn(async () => ({ ok: true, text: 'ok' }));
      startDaemon = vi.fn(async () => {});
      canConnect = vi.fn(async () => true);
    },
  };
});

import { McpServer } from '../../src/mcp-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('MCP Server — request handling', () => {
  let tmpDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-mcp-'));
    vi.mocked(detectBrowser).mockReset();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  function lastResponse(): any {
    const written = stdoutSpy.mock.calls.map(c => String(c[0])).join('');
    return JSON.parse(written.trim().split('\n').pop()!);
  }

  it('browser_open reports failure as isError:true when no browser is detected', async () => {
    vi.mocked(detectBrowser).mockReturnValue(null);
    const server = new McpServer(tmpDir);
    await (server as any).handleRequest({
      id: 1,
      method: 'tools/call',
      params: { name: 'browser_open', arguments: {} },
    });
    const resp = lastResponse();
    expect(resp.id).toBe(1);
    expect(resp.result.isError).toBe(true);
    expect(resp.result.content[0].text).toContain('No browser detected');
  });

  it('browser_open succeeds when a browser is detected (isError:false)', async () => {
    vi.mocked(detectBrowser).mockReturnValue('edge');
    const server = new McpServer(tmpDir);
    await (server as any).handleRequest({
      id: 1,
      method: 'tools/call',
      params: { name: 'browser_open', arguments: {} },
    });
    const resp = lastResponse();
    expect(resp.result.isError).toBe(false);
    expect(resp.result.content[0].text).toContain('started');
  });

  it('browser_close for a session not opened here reports isError:true (no false success)', async () => {
    const server = new McpServer(tmpDir);
    await (server as any).handleRequest({
      id: 1,
      method: 'tools/call',
      params: { name: 'browser_close', arguments: { session: 'external' } },
    });
    const resp = lastResponse();
    expect(resp.result.isError).toBe(true);
    expect(resp.result.content[0].text).toContain('No browser session managed');
  });

  it('browser_close succeeds for a session opened via browser_open', async () => {
    vi.mocked(detectBrowser).mockReturnValue('edge');
    const server = new McpServer(tmpDir);
    await (server as any).handleRequest({
      id: 1,
      method: 'tools/call',
      params: { name: 'browser_open', arguments: {} },
    });
    await (server as any).handleRequest({
      id: 2,
      method: 'tools/call',
      params: { name: 'browser_close', arguments: {} },
    });
    const resp = lastResponse();
    expect(resp.id).toBe(2);
    expect(resp.result.isError).toBe(false);
    expect(resp.result.content[0].text).toContain('closed');
  });
});
