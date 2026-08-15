import { describe, it, expect } from 'vitest';
import { parseCommand, toolCommandName } from '../../src/daemon/backend';

describe('toolCommandName', () => {
  it('normalizes tool names to hyphenated CLI command names', () => {
    expect(toolCommandName('browser_click')).toBe('click');
    expect(toolCommandName('browser_run_code')).toBe('run-code');
    expect(toolCommandName('browser_generate_locator')).toBe('generate-locator');
    expect(toolCommandName('browser_dialog_accept')).toBe('dialog-accept');
    expect(toolCommandName('browser_actions_chain')).toBe('actions-chain');
    expect(toolCommandName('browser_emulate')).toBe('emulate');
  });
});

describe('parseCommand', () => {
  it('maps goto to browser_goto with url', () => {
    const r = parseCommand(['goto', 'https://example.com']);
    expect(r.toolName).toBe('browser_goto');
    expect(r.toolParams).toEqual({ url: 'https://example.com' });
  });

  it('maps go-back to browser_go_back', () => {
    const r = parseCommand(['go-back']);
    expect(r.toolName).toBe('browser_go_back');
    expect(r.toolParams).toEqual({});
  });

  it('maps go-forward to browser_go_forward', () => {
    const r = parseCommand(['go-forward']);
    expect(r.toolName).toBe('browser_go_forward');
    expect(r.toolParams).toEqual({});
  });

  it('maps reload to browser_reload', () => {
    const r = parseCommand(['reload']);
    expect(r.toolName).toBe('browser_reload');
    expect(r.toolParams).toEqual({});
  });

  it('maps title to browser_title', () => {
    const r = parseCommand(['title']);
    expect(r.toolName).toBe('browser_title');
    expect(r.toolParams).toEqual({});
  });

  it('maps url to browser_url', () => {
    const r = parseCommand(['url']);
    expect(r.toolName).toBe('browser_url');
    expect(r.toolParams).toEqual({});
  });

  it('maps click to browser_click with target', () => {
    const r = parseCommand(['click', 'e1']);
    expect(r.toolName).toBe('browser_click');
    expect(r.toolParams).toEqual({ target: 'e1' });
  });

  it('maps fill to browser_fill with target, value, submit=undefined', () => {
    const r = parseCommand(['fill', 'e1', 'hello']);
    expect(r.toolName).toBe('browser_fill');
    expect(r.toolParams.target).toBe('e1');
    expect(r.toolParams.value).toBe('hello');
    expect(r.toolParams.submit).toBeUndefined();
  });

  it('maps type to browser_type with value', () => {
    const r = parseCommand(['type', 'hello']);
    expect(r.toolName).toBe('browser_type');
    expect(r.toolParams).toEqual({ value: 'hello' });
  });

  it('maps press to browser_press with key', () => {
    const r = parseCommand(['press', 'Enter']);
    expect(r.toolName).toBe('browser_press');
    expect(r.toolParams).toEqual({ key: 'Enter' });
  });

  it('maps select to browser_select with target and value', () => {
    const r = parseCommand(['select', 'e1', 'Option']);
    expect(r.toolName).toBe('browser_select');
    expect(r.toolParams).toEqual({ target: 'e1', value: 'Option' });
  });

  it('maps check to browser_check with target', () => {
    const r = parseCommand(['check', 'e1']);
    expect(r.toolName).toBe('browser_check');
    expect(r.toolParams).toEqual({ target: 'e1' });
  });

  it('maps uncheck to browser_uncheck with target', () => {
    const r = parseCommand(['uncheck', 'e1']);
    expect(r.toolName).toBe('browser_uncheck');
    expect(r.toolParams).toEqual({ target: 'e1' });
  });

  it('maps snapshot to browser_snapshot with target', () => {
    const r = parseCommand(['snapshot', 'e1']);
    expect(r.toolName).toBe('browser_snapshot');
    expect(r.toolParams.target).toBe('e1');
    expect(r.toolParams.depth).toBeUndefined();
    expect(r.toolParams.filename).toBeUndefined();
  });

  it('maps find to browser_find with text', () => {
    const r = parseCommand(['find', 'More information']);
    expect(r.toolName).toBe('browser_find');
    expect(r.toolParams.text).toBe('More information');
    expect(r.toolParams.regex).toBeUndefined();
  });

  it('maps screenshot to browser_screenshot with filename', () => {
    const r = parseCommand(['screenshot', '--filename=shot.png']);
    expect(r.toolName).toBe('browser_screenshot');
    expect(r.toolParams.filename).toBe('shot.png');
  });

  it('maps eval to browser_eval with script', () => {
    const r = parseCommand(['eval', 'document.title']);
    expect(r.toolName).toBe('browser_eval');
    expect(r.toolParams.script).toBe('document.title');
  });

  describe('flag parsing', () => {
    it('parses --depth=5 for snapshot', () => {
      const r = parseCommand(['snapshot', '--depth=5']);
      expect(r.toolName).toBe('browser_snapshot');
      expect(r.toolParams.depth).toBe(5);
    });

    it('parses --filename=s.yml for snapshot', () => {
      const r = parseCommand(['snapshot', '--filename=s.yml']);
      expect(r.toolName).toBe('browser_snapshot');
      expect(r.toolParams.filename).toBe('s.yml');
    });

    it('parses --regex=pattern for find', () => {
      const r = parseCommand(['find', '--regex=pattern']);
      expect(r.toolName).toBe('browser_find');
      expect(r.toolParams.regex).toBe('pattern');
    });

    it('parses --filename=shot.png for screenshot', () => {
      const r = parseCommand(['screenshot', '--filename=shot.png']);
      expect(r.toolName).toBe('browser_screenshot');
      expect(r.toolParams.filename).toBe('shot.png');
    });

    it('parses --submit flag for fill', () => {
      const r = parseCommand(['fill', 'e1', 'hello', '--submit']);
      expect(r.toolName).toBe('browser_fill');
      expect(r.toolParams.submit).toBe(true);
      expect(r.toolParams.target).toBe('e1');
      expect(r.toolParams.value).toBe('hello');
    });

    it('parses emulate --offline', () => {
      const r = parseCommand(['emulate', '--offline']);
      expect(r.toolName).toBe('browser_emulate');
      expect(r.toolParams.offline).toBe(true);
    });

    it('parses emulate --offline=false (explicit restore)', () => {
      const r = parseCommand(['emulate', '--offline=false']);
      expect(r.toolName).toBe('browser_emulate');
      expect(r.toolParams.offline).toBe(false);
    });

    it('parses emulate --throttle-network and --throttle-cpu', () => {
      const r = parseCommand(['emulate', '--throttle-network=slow3g', '--throttle-cpu=4']);
      expect(r.toolName).toBe('browser_emulate');
      expect(r.toolParams.throttleNetwork).toBe('slow3g');
      expect(r.toolParams.throttleCpu).toBe('4');
    });

    it('parses emulate --reset', () => {
      const r = parseCommand(['emulate', '--reset']);
      expect(r.toolName).toBe('browser_emulate');
      expect(r.toolParams.reset).toBe(true);
    });

    it('maps device and device-list commands', () => {
      const d = parseCommand(['device', 'iPhone 13']);
      expect(d.toolName).toBe('browser_device');
      expect(d.toolParams.name).toBe('iPhone 13');
      const l = parseCommand(['device-list']);
      expect(l.toolName).toBe('browser_device_list');
    });
  });

  describe('v0.2 commands', () => {
    it('maps cookie-list to browser_cookie_list', () => {
      const r = parseCommand(['cookie-list']);
      expect(r.toolName).toBe('browser_cookie_list');
      expect(r.toolParams).toEqual({ bidi: false, userContext: undefined });
    });

    it('maps cookie-list --bidi --user-context to browser_cookie_list with partition', () => {
      const r = parseCommand(['cookie-list', '--bidi', '--user-context=ctx-1']);
      expect(r.toolName).toBe('browser_cookie_list');
      expect(r.toolParams).toEqual({ bidi: true, userContext: 'ctx-1' });
    });

    it('maps cookie-get to browser_cookie_get with name', () => {
      const r = parseCommand(['cookie-get', 'session']);
      expect(r.toolName).toBe('browser_cookie_get');
      expect(r.toolParams).toEqual({ name: 'session' });
    });

    it('maps cookie-set to browser_cookie_set with name and value', () => {
      const r = parseCommand(['cookie-set', 'token', 'abc123']);
      expect(r.toolName).toBe('browser_cookie_set');
      expect(r.toolParams.name).toBe('token');
      expect(r.toolParams.value).toBe('abc123');
      expect(r.toolParams.bidi).toBe(false);
    });

    it('maps cookie-set --bidi with flags to browser_cookie_set', () => {
      const r = parseCommand(['cookie-set', 'token', 'abc123', '--bidi', '--user-context=ctx-2', '--domain=example.com', '--path=/', '--httpOnly', '--secure']);
      expect(r.toolName).toBe('browser_cookie_set');
      expect(r.toolParams).toMatchObject({
        bidi: true,
        userContext: 'ctx-2',
        domain: 'example.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    });

    it('maps cookie-delete to browser_cookie_delete with name', () => {
      const r = parseCommand(['cookie-delete', 'token']);
      expect(r.toolName).toBe('browser_cookie_delete');
      expect(r.toolParams).toEqual({ name: 'token' });
    });

    it('maps cookie-delete without name (delete all)', () => {
      const r = parseCommand(['cookie-delete']);
      expect(r.toolName).toBe('browser_cookie_delete');
      expect(r.toolParams.name).toBeUndefined();
    });

    it('maps localstorage-get to browser_localstorage_get with key', () => {
      const r = parseCommand(['localstorage-get', 'theme']);
      expect(r.toolName).toBe('browser_localstorage_get');
      expect(r.toolParams).toEqual({ key: 'theme' });
    });

    it('maps localstorage-set to browser_localstorage_set with key and value', () => {
      const r = parseCommand(['localstorage-set', 'theme', 'dark']);
      expect(r.toolName).toBe('browser_localstorage_set');
      expect(r.toolParams).toEqual({ key: 'theme', value: 'dark' });
    });

    it('maps localstorage-delete to browser_localstorage_delete', () => {
      const r = parseCommand(['localstorage-delete', 'theme']);
      expect(r.toolName).toBe('browser_localstorage_delete');
      expect(r.toolParams).toEqual({ key: 'theme' });
    });

    it('maps localstorage-list to browser_localstorage_list', () => {
      const r = parseCommand(['localstorage-list']);
      expect(r.toolName).toBe('browser_localstorage_list');
      expect(r.toolParams).toEqual({});
    });

    it('maps sessionstorage-get to browser_sessionstorage_get', () => {
      const r = parseCommand(['sessionstorage-get', 'temp']);
      expect(r.toolName).toBe('browser_sessionstorage_get');
      expect(r.toolParams).toEqual({ key: 'temp' });
    });

    it('maps sessionstorage-set to browser_sessionstorage_set', () => {
      const r = parseCommand(['sessionstorage-set', 'temp', 'val']);
      expect(r.toolName).toBe('browser_sessionstorage_set');
      expect(r.toolParams).toEqual({ key: 'temp', value: 'val' });
    });

    it('maps sessionstorage-delete to browser_sessionstorage_delete', () => {
      const r = parseCommand(['sessionstorage-delete', 'temp']);
      expect(r.toolName).toBe('browser_sessionstorage_delete');
      expect(r.toolParams).toEqual({ key: 'temp' });
    });

    it('maps sessionstorage-list to browser_sessionstorage_list', () => {
      const r = parseCommand(['sessionstorage-list']);
      expect(r.toolName).toBe('browser_sessionstorage_list');
      expect(r.toolParams).toEqual({});
    });

    it('maps tab-list to browser_tab_list', () => {
      const r = parseCommand(['tab-list']);
      expect(r.toolName).toBe('browser_tab_list');
      expect(r.toolParams).toEqual({});
    });

    it('maps tab-new to browser_tab_new with url', () => {
      const r = parseCommand(['tab-new', 'https://example.com']);
      expect(r.toolName).toBe('browser_tab_new');
      expect(r.toolParams.url).toBe('https://example.com');
    });

    it('maps tab-new without url', () => {
      const r = parseCommand(['tab-new']);
      expect(r.toolName).toBe('browser_tab_new');
      expect(r.toolParams.url).toBeUndefined();
    });

    it('maps tab-close to browser_tab_close', () => {
      const r = parseCommand(['tab-close']);
      expect(r.toolName).toBe('browser_tab_close');
      expect(r.toolParams).toEqual({});
    });

    it('maps tab-select to browser_tab_select with index', () => {
      const r = parseCommand(['tab-select', '1']);
      expect(r.toolName).toBe('browser_tab_select');
      expect(r.toolParams.index).toBe(1);
    });

    it('maps tab-select without index defaults to 0', () => {
      const r = parseCommand(['tab-select']);
      expect(r.toolName).toBe('browser_tab_select');
      expect(r.toolParams.index).toBe(0);
    });

    it('maps state-save to browser_state_save with filename', () => {
      const r = parseCommand(['state-save', '--filename=state.json']);
      expect(r.toolName).toBe('browser_state_save');
      expect(r.toolParams.filename).toBe('state.json');
    });

    it('maps state-save without filename', () => {
      const r = parseCommand(['state-save']);
      expect(r.toolName).toBe('browser_state_save');
      expect(r.toolParams.filename).toBeUndefined();
    });

    it('maps state-load to browser_state_load with filename', () => {
      const r = parseCommand(['state-load', '--filename=state.json']);
      expect(r.toolName).toBe('browser_state_load');
      expect(r.toolParams.filename).toBe('state.json');
    });
  });

  describe('v0.13 preload commands', () => {
    it('maps preload add to browser_preload_add with script', () => {
      const r = parseCommand(['preload', 'add', '--script=window.__p = 1']);
      expect(r.toolName).toBe('browser_preload_add');
      expect(r.toolParams).toEqual({ script: 'window.__p = 1', context: undefined });
    });

    it('maps preload add with a context', () => {
      const r = parseCommand(['preload', 'add', '--script=x', '--context=ctx-1']);
      expect(r.toolName).toBe('browser_preload_add');
      expect(r.toolParams.context).toBe('ctx-1');
    });

    it('maps preload remove to browser_preload_remove with id', () => {
      const r = parseCommand(['preload', 'remove', '--id=preload-1']);
      expect(r.toolName).toBe('browser_preload_remove');
      expect(r.toolParams).toEqual({ id: 'preload-1' });
    });

    it('maps preload list to browser_preload_list', () => {
      const r = parseCommand(['preload', 'list']);
      expect(r.toolName).toBe('browser_preload_list');
      expect(r.toolParams).toEqual({});
    });

    it('rejects unknown preload subcommands', () => {
      expect(() => parseCommand(['preload', 'dump'])).toThrow(/Unknown preload subcommand/);
    });
  });

  describe('v0.13 context commands', () => {
    it('maps context-new to browser_context_new', () => {
      const r = parseCommand(['context-new']);
      expect(r.toolName).toBe('browser_context_new');
      expect(r.toolParams).toEqual({});
    });

    it('maps context-close to browser_context_close with id', () => {
      const r = parseCommand(['context-close', '--id=ctx-1']);
      expect(r.toolName).toBe('browser_context_close');
      expect(r.toolParams).toEqual({ id: 'ctx-1' });
    });

    it('maps context-list to browser_context_list', () => {
      const r = parseCommand(['context-list']);
      expect(r.toolName).toBe('browser_context_list');
      expect(r.toolParams).toEqual({});
    });
  });

  describe('v0.13 upload --bidi', () => {
    it('passes bidi flag through to browser_upload', () => {
      const r = parseCommand(['upload', 'e1', 'a.txt', '--bidi']);
      expect(r.toolName).toBe('browser_upload');
      expect(r.toolParams).toEqual({ target: 'e1', file: 'a.txt', bidi: true });
    });

    it('defaults bidi to false', () => {
      const r = parseCommand(['upload', 'e1', 'a.txt']);
      expect(r.toolName).toBe('browser_upload');
      expect(r.toolParams.bidi).toBe(false);
    });
  });

  it('throws on unknown command', () => {
    expect(() => parseCommand(['unknown-cmd'])).toThrow(/Unknown command/);
  });

  // --- v0.4: Config commands ---

  it('maps config get to config_get', () => {
    const r = parseCommand(['config', 'get', 'wait.timeout']);
    expect(r.toolName).toBe('config_get');
    expect(r.toolParams).toEqual({ key: 'wait.timeout' });
  });

  it('maps config set to config_set', () => {
    const r = parseCommand(['config', 'set', 'wait.timeout', '8000']);
    expect(r.toolName).toBe('config_set');
    expect(r.toolParams).toEqual({ key: 'wait.timeout', value: '8000' });
  });

  it('maps config list to config_list', () => {
    const r = parseCommand(['config', 'list']);
    expect(r.toolName).toBe('config_list');
    expect(r.toolParams).toEqual({});
  });

  it('maps config init to config_init', () => {
    const r = parseCommand(['config', 'init']);
    expect(r.toolName).toBe('config_init');
    expect(r.toolParams).toEqual({});
  });

  it('throws on unknown config subcommand', () => {
    expect(() => parseCommand(['config', 'unknown'])).toThrow(/Unknown config subcommand/);
  });

  // --- v0.4: Wait/retry flag extraction ---

  it('extracts --timeout flag', () => {
    const r = parseCommand(['click', 'e1', '--timeout=10000']);
    expect(r.flags.timeout).toBe('10000');
  });

  it('extracts --wait flag', () => {
    const r = parseCommand(['click', 'e1', '--wait=visible']);
    expect(r.flags.wait).toBe('visible');
  });

  it('extracts --retry flag', () => {
    const r = parseCommand(['click', 'e1', '--retry=3']);
    expect(r.flags.retry).toBe('3');
  });

  it('extracts --retry-interval flag', () => {
    const r = parseCommand(['click', 'e1', '--retry-interval=500']);
    expect(r.flags['retry-interval']).toBe('500');
  });

  it('extracts --no-wait flag', () => {
    const r = parseCommand(['click', 'e1', '--no-wait']);
    expect(r.flags['no-wait']).toBe(true);
  });

  it('extracts --implicit-wait flag', () => {
    const r = parseCommand(['click', 'e1', '--implicit-wait=2000']);
    expect(r.flags['implicit-wait']).toBe('2000');
  });

  it('extracts --page-load-timeout flag', () => {
    const r = parseCommand(['goto', 'https://example.com', '--page-load-timeout=60000']);
    expect(r.flags['page-load-timeout']).toBe('60000');
  });

  it('extracts --script-timeout flag', () => {
    const r = parseCommand(['eval', 'document.title', '--script-timeout=45000']);
    expect(r.flags['script-timeout']).toBe('45000');
  });

  it('returns empty flags when no wait/retry flags provided', () => {
    const r = parseCommand(['click', 'e1']);
    expect(r.flags).toEqual({});
  });

  it('extracts multiple wait/retry flags simultaneously', () => {
    const r = parseCommand(['click', 'e1', '--wait=visible', '--timeout=10000', '--retry=3', '--retry-interval=200']);
    expect(r.flags.wait).toBe('visible');
    expect(r.flags.timeout).toBe('10000');
    expect(r.flags.retry).toBe('3');
    expect(r.flags['retry-interval']).toBe('200');
  });
});
