import * as net from 'net';
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
      if (!headed) builder.getCapabilities().set('goog:chromeOptions', { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'] });
      if (cdpEndpoint) builder.getCapabilities().set('goog:chromeOptions', { debuggerAddress: cdpEndpoint });
      driver = await builder.build();
    }
    const { toolName, toolParams } = parseCommand(msg.params.args);
    const response = await callTool(driver, toolName, toolParams, { raw: !!msg.params.raw, json: !!msg.params.json });
    return { ok: true, text: response.serialize() };
  } catch (e: any) {
    return { ok: false, error: e.message, code: 'DRIVER_ERROR' };
  }
}

async function shutdown() {
  try {
    if (driver) await driver.quit();
  } catch {}
  registry.deleteSession(wsHash, sessionName);
  server.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  if (Date.now() - lastActivity > 30 * 60 * 1000) shutdown();
}, 60 * 1000);

const config: SessionConfig = {
  name: sessionName,
  version,
  timestamp: Date.now(),
  socketPath,
  workspaceDir,
  persistent: false,
  browserName,
};
registry.writeSession(wsHash, config);

server.listen(socketPath, () => {
  console.log(`Daemon listening on ${socketPath}`);
});
