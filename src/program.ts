import { parseArgs } from './minimist';
import { Session } from './session';
import { Registry } from './registry';
import { baseDaemonDir, workspaceHash } from './config';
import { render } from './output';
import * as path from 'path';
import * as fs from 'fs';

export async function main(argv: string[]): Promise<void> {
  const opts = {
    boolean: ['headed', 'raw', 'json', 'persistent', 'help'],
    string: ['browser', 'filename', 'depth', 's', 'session', 'cdp'],
    alias: { s: 'session' },
  };
  const args = parseArgs(argv, opts);

  if (args.help || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const sessionName = args.session || process.env.SELENIUM_CLI_SESSION || 'default';
  const cwd = process.cwd();
  const workspaceDir = findWorkspaceDir(cwd);
  const session = new Session(workspaceDir, sessionName);

  const cmd = args._[0];

  if (cmd === 'open') {
    const url = args._[1];
    const openOpts: any = {};
    if (args.browser) openOpts.browserName = args.browser;
    if (args.headed) openOpts.headed = true;
    if (args.cdp) openOpts.cdpEndpoint = args.cdp;
    await session.startDaemon(openOpts);
    if (url) {
      const resp = await session.run(['goto', url], cwd, { raw: args.raw, json: args.json });
      render(resp);
    }
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

  if (cmd === 'close-all' || cmd === 'kill-all') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      const sess = new Session(workspaceDir, s.name);
      try { await sess.stop(); } catch {}
    }
    return;
  }

  // Tool commands — forward to daemon
  const resp = await session.run(argv, cwd, { raw: args.raw, json: args.json });
  render(resp);
}

function findWorkspaceDir(cwd: string): string {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.selenium-cli'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

function printHelp(): void {
  console.log(`selenium-cli - token-efficient Selenium browser automation

Usage:
  selenium-cli open [url] [--browser=chrome|edge|firefox] [--headed] [--cdp=url]
  selenium-cli close
  selenium-cli list
  selenium-cli close-all
  selenium-cli -s=<name> <cmd>

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

Flags:
  --raw                   output only the result value
  --json                  structured JSON output
  -s=<name>               session name
  --browser=chrome        browser (default chrome)
  --headed                show browser window (default headless)
  --cdp=<url>             attach to running Chrome via CDP
`);
}
