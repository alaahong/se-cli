import * as net from 'net';
import * as fs from 'fs';
import { Registry, SessionConfig } from '../registry';
import { baseDaemonDir } from '../config';
import type { ClientMessage, ServerMessage } from '../protocol';

const args = process.argv.slice(2);
const sessionName = args[0];
const socketPath = args[1];
const workspaceDir = args[2];
const browserName = (args[3] as 'chrome' | 'edge' | 'firefox') || 'chrome';
const headed = args.includes('--headed');
const cdpEndpoint = args.find(a => a.startsWith('--cdp='))?.slice('--cdp='.length);
const version = require('../../package.json').version;

let driver: any = null;
let lastActivity = Date.now();
const crypto = require('crypto');
const wsHash = crypto.createHash('sha1').update(workspaceDir).digest('hex').slice(0, 16);
const registry = new Registry(baseDaemonDir());

const server = net.createServer((socket) => {
  let buffer = '';
  socket.on('data', async (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg: ClientMessage = JSON.parse(line);
        lastActivity = Date.now();
        const response = await handleMessage(msg);
        socket.write(JSON.stringify(response) + '\n');
      } catch (e: any) {
        const errResp: ServerMessage = { ok: false, error: e.message, code: 'DRIVER_ERROR' };
        socket.write(JSON.stringify(errResp) + '\n');
      }
    }
  });
  socket.on('error', () => {
    // Silently ignore socket errors (client disconnect, EPIPE, etc.)
  });
});

async function handleMessage(msg: ClientMessage): Promise<ServerMessage> {
  if (msg.method === 'ping') return { ok: true, text: 'pong' };
  if (msg.method === 'stop') {
    await shutdown();
    return { ok: true, text: 'stopping' };
  }
  // method === 'run' — dispatch to backend
  const { callTool, parseCommand } = require('./backend');
  try {
    if (!driver) {
      const { Builder } = require('selenium-webdriver');
      const builder = new Builder().forBrowser(browserName);
      if (browserName === 'chrome') {
        const chromeOpts: any = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
        if (!headed && !cdpEndpoint) chromeOpts.args.unshift('--headless=new');
        if (cdpEndpoint) chromeOpts.debuggerAddress = cdpEndpoint;
        builder.getCapabilities().set('goog:chromeOptions', chromeOpts);
      }
      driver = await builder.build();
    }
    const { toolName, toolParams } = parseCommand(msg.params.args);
    const response = await callTool(driver, toolName, toolParams, { raw: !!msg.params.raw, json: !!msg.params.json });
    return { ok: true, text: response.serialize() };
  } catch (e: any) {
    let code: ServerMessage['code'] = 'DRIVER_ERROR';
    const name = e.name || '';
    if (name === 'NoSuchElementError' || name === 'StaleElementReferenceError') code = 'ELEMENT_NOT_FOUND';
    else if (name === 'TimeoutError') code = 'TIMEOUT';
    return { ok: false, error: e.message, code };
  }
}

async function shutdown() {
  try {
    if (driver) await driver.quit();
  } catch (e: any) {
    process.stderr.write(`driver quit failed: ${e.message}\n`);
  }
  registry.deleteSession(wsHash, sessionName);
  server.close();
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch {}
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  if (Date.now() - lastActivity > 30 * 60 * 1000) shutdown();
}, 60 * 1000);

// Heartbeat: periodically check driver health via getTitle()
setInterval(async () => {
  if (!driver) return;
  try {
    await driver.getTitle();
  } catch (e: any) {
    process.stderr.write('heartbeat failed: ' + e.message + '\n');
    await shutdown();
  }
}, 60 * 1000);

const config: SessionConfig = {
  name: sessionName,
  version,
  timestamp: Date.now(),
  socketPath,
  workspaceDir,
  persistent: false,
  browserName,
  pid: process.pid,
};
registry.writeSession(wsHash, config);

server.on('error', (err: any) => {
  process.stderr.write(`Server error: ${err.message}\n`);
  shutdown();
});

// Remove stale socket file on POSIX
if (process.platform !== 'win32') {
  try { fs.unlinkSync(socketPath); } catch {}
}

server.listen(socketPath, () => {
  console.log(`Daemon listening on ${socketPath}`);
});
