import { parseArgs } from './minimist';
import { Session } from './session';
import { Registry } from './registry';
import { baseDaemonDir, workspaceHash } from './config';
import { render } from './output';
import { detectBrowser } from './detect-browser';
import type { ServerMessage } from './protocol';
import {
  loadConfigFile,
  getConfigValue,
  setConfigValue,
  listConfig,
  generateTemplateConfig,
  resolveConfig,
} from './wait-config';
import * as path from 'path';
import * as fs from 'fs';

export async function main(argv: string[]): Promise<void> {
  const opts = {
    boolean: ['headed', 'raw', 'json', 'persistent', 'help', 'no-wait'],
    string: [
      'browser', 'filename', 'depth', 's', 'session', 'cdp', 'profile',
      // v0.4 wait/retry flags
      'timeout', 'wait', 'retry', 'retry-interval',
      'implicit-wait', 'page-load-timeout', 'script-timeout',
    ],
    alias: { s: 'session' },
  };
  const args = parseArgs(argv, opts);

  if (args.help || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const sessionName = args.session || process.env.SE_CLI_SESSION || 'default';
  const cwd = process.cwd();
  const workspaceDir = findWorkspaceDir(cwd);
  const session = new Session(workspaceDir, sessionName);

  const cmd = args._[0];

  if (cmd === 'open') {
    const url = args._[1];
    const openOpts: any = {};
    if (args.browser) {
      openOpts.browserName = args.browser;
    } else if (!args.cdp) {
      // No explicit --browser and no CDP attach: probe installed browsers
      // in the order Edge → Chrome → Firefox, and fail if none is found.
      const detected = detectBrowser();
      if (!detected) {
        console.error('Error: No browser detected. Install Edge, Chrome, or Firefox, or specify --browser=<name>.');
        process.exit(1);
      }
      openOpts.browserName = detected;
    }
    if (args.headed) openOpts.headed = true;
    if (args.cdp) openOpts.cdpEndpoint = args.cdp;
    if (args.profile) openOpts.profilePath = args.profile;
    if (args.persistent) {
      openOpts.persistent = true;
      // Auto-assign profile path
      const wsHash = workspaceHash(workspaceDir);
      openOpts.profilePath = path.join(baseDaemonDir(), 'profiles', wsHash, sessionName);
    }
    await session.startDaemon(openOpts);
    if (url) {
      const resp = await session.run(['goto', url], cwd, { raw: args.raw, json: args.json });
      render(resp);
    }
    return;
  }

  // MCP Server mode — start a long-lived MCP server over stdio
  if (cmd === 'mcp-server') {
    const { startMcpServer } = require('./mcp-server');
    startMcpServer(workspaceDir);
    return;
  }

  if (cmd === 'install') {
    const target = args._[1] || 'claude'; // 默认 claude
    const targetMap: Record<string, string> = {
      'claude': path.join('.claude', 'skills', 'se-cli'),
      'cursor': path.join('.cursor', 'skills', 'se-cli'),
      'generic': path.join('.agents', 'skills', 'se-cli'),
    };
    const skillDir = targetMap[target];
    if (!skillDir) {
      console.error(`Unknown target: ${target}. Supported: claude, cursor, generic`);
      process.exit(1);
    }
    const skillSource = path.join(__dirname, '..', 'skill', 'SKILL.md');
    if (!fs.existsSync(skillSource)) {
      console.error('SKILL.md not found in package. This may be a development installation.');
      process.exit(1);
    }
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(skillSource, path.join(skillDir, 'SKILL.md'));
    console.log(`Skill installed to ${skillDir}`);
    return;
  }

  if (cmd === 'close') {
    await session.stop();
    return;
  }

  if (cmd === 'list') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      const alive = await new Session(workspaceDir, s.name).canConnect();
      const status = alive ? 'live' : 'dead';
      console.log(`${s.name}\t${status}\t${s.browserName}\t${new Date(s.timestamp).toISOString()}`);
    }
    return;
  }

  if (cmd === 'close-all') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      const sess = new Session(workspaceDir, s.name);
      try { await sess.stop(); } catch {}
    }
    return;
  }

  if (cmd === 'kill-all') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      // Force-kill daemon process if we have a PID
      const cfg = registry.loadSession(wsHash, s.name);
      if (cfg && cfg.pid) {
        try { process.kill(cfg.pid, 'SIGKILL'); } catch {}
      }
      // Also try graceful stop in case process is still alive
      const sess = new Session(workspaceDir, s.name);
      try { await sess.stop(); } catch {}
      registry.deleteSession(wsHash, s.name);
    }
    return;
  }

  // v0.4: config commands — handled locally, no daemon needed
  if (cmd === 'config') {
    const subCmd = args._[1];
    if (subCmd === 'get') {
      const key = args._[2];
      if (!key) {
        console.error('Usage: se-cli config get <key>');
        process.exit(1);
      }
      const fileConfig = loadConfigFile(cwd);
      if (!fileConfig) {
        console.log('(no config file found)');
        return;
      }
      const result = getConfigValue(fileConfig, key);
      if (result) {
        console.log(result.value);
      } else {
        console.log(`(not set: ${key})`);
      }
    } else if (subCmd === 'set') {
      const key = args._[2];
      const value = args._[3];
      if (!key || !value) {
        console.error('Usage: se-cli config set <key> <value>');
        process.exit(1);
      }
      setConfigValue(cwd, key, value);
      console.log(`Set ${key} = ${value}`);
    } else if (subCmd === 'list') {
      const resolved = resolveConfig({}, cwd, process.env as any);
      const lines = listConfig(resolved);
      for (const line of lines) console.log(line);
    } else if (subCmd === 'init') {
      generateTemplateConfig(cwd);
      console.log('Generated .se-cli.json');
    } else {
      console.error('Usage: se-cli config [get|set|list|init]');
      process.exit(1);
    }
    return;
  }

  // Tool commands — forward to daemon.
  // Strip CLI-level flags (--raw, --json, --headed, --browser, --cdp, -s, --session,
  // --persistent, --help) so the daemon only sees the command and its tool-specific
  // flags (e.g. --filename, --depth, --regex, --submit).
  const cliFlags = new Set(['raw', 'json', 'headed', 'persistent', 'help', 'browser', 'cdp', 's', 'session', 'profile']);
  const forwardArgs = argv.filter(arg => {
    const m = arg.match(/^-{1,2}([\w-]+)(=.*)?$/);
    if (!m) return true; // positional arg — keep
    return !cliFlags.has(m[1]);
  });
  let resp: ServerMessage;
  try {
    resp = await session.run(forwardArgs, cwd, { raw: args.raw, json: args.json });
  } catch (e: any) {
    // Connection failed: clean up orphan session file and hint to reopen
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    registry.deleteSession(wsHash, sessionName);
    console.error('### Error\nDaemon not reachable: ' + (e.message || e) + '\nHint: run `se-cli open` to start a new session.');
    process.exit(1);
  }
  render(resp);
}

export function findWorkspaceDir(cwd: string): string {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.se-cli'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

function printHelp(): void {
  console.log(`se-cli - token-efficient Selenium browser automation

Usage:
  se-cli open [url] [--browser=chrome|edge|firefox] [--headed] [--cdp=url] [--profile=path] [--persistent]
  se-cli install [claude|cursor|generic]
  se-cli mcp-server               start MCP server (stdio mode for VS Code / AI agents)
  se-cli close
  se-cli list
  se-cli close-all
  se-cli kill-all
  se-cli config [get|set|list|init]
  se-cli -s=<name> <cmd>

Commands:
  goto <url>              navigate to url
  go-back / go-forward / reload
  click <ref|selector>    click element
  fill <ref|selector> <text>
  type <text>             type into focused element
  press <key>             press keyboard key
  select <ref> <value>    select dropdown option
  check <ref> / uncheck <ref>
  snapshot [ref] [--depth=N]
  find <text> / find --regex <pattern>
  screenshot [ref] [--filename=f]
  eval "<js>" [ref]
  title / url
  cookie-list / cookie-get <name> / cookie-set <name> <val> / cookie-delete [name]
  localstorage-get <key> / localstorage-set <key> <val> / localstorage-delete [key] / localstorage-list
  sessionstorage-get <key> / sessionstorage-set <key> <val> / sessionstorage-delete [key] / sessionstorage-list
  tab-list / tab-new [url] / tab-close / tab-select <index>
  state-save [--filename=f] / state-load [--filename=f]
  config get <key>        get config value (e.g. wait.timeout)
  config set <key> <val>  set config value in .se-cli.json
  config list             list all config values with sources
  config init            generate template .se-cli.json

MCP Server:
  mcp-server              start MCP server in stdio mode (for VS Code / AI agents)
                          exposes all browser commands as MCP tools

Interaction (v0.5):
  hover <ref>             mouse hover over element
  dblclick <ref>          double-click element
  drag <start> <end>     drag and drop element
  dialog-accept [text]    accept alert/confirm/prompt dialog
  dialog-dismiss          dismiss dialog
  upload <ref> <file>     upload file to input element
  resize <w> <h>          set viewport size
  keydown <key>          press and hold key
  keyup <key>             release held key
  mousemove <x> <y>      move mouse to coordinates
  mousedown [button]      press mouse button (left/right/middle)
  mouseup [button]        release mouse button
  mousewheel <dx> <dy>   scroll wheel by offsets
  actions-chain <json>    chain multiple actions in one perform()

Assertions (v0.6):
  expect <ref> visible    assert element is visible (exit 0/1)
  expect <ref> hidden     assert element is hidden
  expect <ref> enabled    assert element is enabled
  expect <ref> disabled   assert element is disabled
  expect <ref> checked    assert checkbox is checked
  expect <ref> unchecked  assert checkbox is unchecked
  expect <ref> text "..."  assert element text [--exact] [--not]
  expect <ref> value "..." assert input value [--exact] [--not]
  expect <ref> count N     assert matching element count
  expect <ref> attribute <name> <value>  assert attribute value
  expect title "..."       assert page title [--exact] [--not]
  expect url "..."         assert page URL [--exact] [--not]
  Flags: --not (invert), --exact (strict match), --timeout=<ms>

Network & Debugging (v0.7):
  highlight [ref]           outline element (default: 3px solid red)
  highlight <ref> --style="2px solid blue"
  highlight <ref> --hide    remove single highlight
  highlight --hide --all    remove all highlights
  console                   all buffered messages
  console error             error-level only
  console js-error          JS exceptions only
  console --since=5m        messages from last 5 minutes
  console --clear           clear buffer after output
  requests                  list all network requests
  requests --filter="api"   filter by URL substring
  requests --status=500     filter by status code
  requests --method=POST    filter by HTTP method
  requests --clear          clear request buffer
  request <index>           show request details (headers, body, response)
  route <pattern> --status=401 --body='{"error":"invalid"}'
  route-list                list active route mocks
  unroute <index>           remove specific route
  unroute --all             remove all routes

Flags:
  --raw                   output only the result value
  --json                  structured JSON output
  -s=<name>               session name
  --browser=chrome        browser (default: auto-detect Edge → Chrome → Firefox)
  --headed                show browser window (default headless)
  --cdp=<url>             attach to running Chrome via CDP
  --profile=<path>        use a persistent browser profile directory
  --persistent            keep browser profile across sessions (auto-assigns profile path)

Wait & Retry (v0.4):
  --timeout=<ms>          per-command explicit-wait timeout (default 5000)
  --wait=<state>          wait condition: visible|hidden|enabled|disabled|stable|attached|none|auto (default auto)
  --retry=<n>             failure retry count (default 0; -1 = until timeout)
  --retry-interval=<ms>   polling interval (default 100)
  --implicit-wait=<ms>    driver implicit wait (default 0)
  --page-load-timeout=<ms>  page load timeout (default 30000)
  --script-timeout=<ms>  script timeout for async eval (default 30000)
  --no-wait               shorthand for --wait=none --timeout=0

Environment:
  SE_CLI_TIMEOUT / SE_CLI_WAIT / SE_CLI_RETRY / SE_CLI_RETRY_INTERVAL
  SE_CLI_IMPLICIT_WAIT / SE_CLI_PAGE_LOAD_TIMEOUT / SE_CLI_SCRIPT_TIMEOUT
`);
}
