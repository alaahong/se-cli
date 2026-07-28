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

const ALLOWED_BROWSERS = new Set(['chrome', 'edge', 'firefox']);
if (!ALLOWED_BROWSERS.has(browserName)) {
  throw new Error(`Unsupported browser: ${browserName}. Supported: chrome, edge, firefox`);
}

let driver: any = null;
let lastActivity = Date.now();
const crypto = require('crypto');
const wsHash = crypto.createHash('sha1').update(workspaceDir).digest('hex').slice(0, 16);
const registry = new Registry(baseDaemonDir());

// Track the current socket so we can send an error response if the
// process crashes unexpectedly (e.g. native browser driver crash).
let activeSocket: net.Socket | null = null;

const server = net.createServer((socket) => {
  activeSocket = socket;
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
        // Handle 'stop' specially: send response before shutting down,
        // otherwise process.exit() kills the socket before the client
        // receives the acknowledgement.
        if (msg.method === 'stop') {
          socket.write(JSON.stringify({ ok: true, text: 'stopping' } as ServerMessage) + '\n');
          socket.end();
          shutdown();
          return;
        }
        const response = await handleMessage(msg);
        socket.write(JSON.stringify(response) + '\n');
      } catch (e: any) {
        const errResp: ServerMessage = { ok: false, error: e.message, code: 'DRIVER_ERROR' };
        try { socket.write(JSON.stringify(errResp) + '\n'); } catch {}
      }
    }
  });
  socket.on('error', () => {
    // Silently ignore socket errors (client disconnect, EPIPE, etc.)
  });
});

async function handleMessage(msg: ClientMessage): Promise<ServerMessage> {
  if (msg.method === 'ping') return { ok: true, text: 'pong' };
  // method === 'run' — dispatch to backend
  const { callTool, parseCommand } = require('./backend');
  try {
    if (!driver) {
      const { Builder } = require('selenium-webdriver');
      // selenium-webdriver expects 'MicrosoftEdge' for Edge, not 'edge'.
      const seleniumBrowserName = browserName === 'edge' ? 'MicrosoftEdge' : browserName;
      const builder = new Builder().forBrowser(seleniumBrowserName);

      if (browserName === 'chrome') {
        const chromeArgs: string[] = [];
        if (!headed && !cdpEndpoint) chromeArgs.push('--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu');
        const chromeOpts: any = { args: chromeArgs };
        if (cdpEndpoint) chromeOpts.debuggerAddress = cdpEndpoint;
        builder.getCapabilities().set('goog:chromeOptions', chromeOpts);
      } else if (browserName === 'edge') {
        const edgeArgs: string[] = [];
        if (!headed) edgeArgs.push('--headless=new', '--disable-gpu');
        const edgeOpts: any = { args: edgeArgs };
        if (cdpEndpoint) edgeOpts.debuggerAddress = cdpEndpoint;
        builder.getCapabilities().set('ms:edgeOptions', edgeOpts);
      } else if (browserName === 'firefox') {
        const firefoxOpts: any = {};
        if (!headed) {
          firefoxOpts.args = ['-headless', '--no-remote'];
        }
        builder.getCapabilities().set('moz:firefoxOptions', firefoxOpts);
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

// Catch uncaught exceptions so the daemon doesn't silently crash.
// Try to send an error response to the client before shutting down.
process.on('uncaughtException', (err: Error) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n${err.stack || ''}\n`);
  if (activeSocket && !activeSocket.destroyed) {
    try {
      const errResp: ServerMessage = { ok: false, error: `daemon crash: ${err.message}`, code: 'DRIVER_ERROR' };
      activeSocket.write(JSON.stringify(errResp) + '\n');
      activeSocket.end();
    } catch {}
  }
  shutdown();
});

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
