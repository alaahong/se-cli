import * as net from 'net';
import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
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
const profilePath = args.find(a => a.startsWith('--profile='))?.slice('--profile='.length);
const persistent = args.includes('--persistent');
const version = require('../../package.json').version;

const ALLOWED_BROWSERS = new Set(['chrome', 'edge', 'firefox']);
if (!ALLOWED_BROWSERS.has(browserName)) {
  throw new Error(`Unsupported browser: ${browserName}. Supported: chrome, edge, firefox`);
}

let driver: any = null;
let driverInitError: string | null = null;
let lastActivity = Date.now();
const crypto = require('crypto');
const wsHash = crypto.createHash('sha1').update(workspaceDir).digest('hex').slice(0, 16);
const registry = new Registry(baseDaemonDir());

// Track the current socket so we can send an error response if the
// process crashes unexpectedly (e.g. native browser driver crash).
let activeSocket: net.Socket | null = null;

const server = net.createServer((socket) => {
  activeSocket = socket;
  // Use StringDecoder to handle multi-byte UTF-8 characters (e.g. Chinese)
  // that may be split across TCP socket chunks. Without this, data.toString()
  // on a partial multi-byte sequence produces replacement chars (U+FFFD),
  // causing garbled text for non-ASCII content (e.g. Baidu snapshots).
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  socket.on('data', async (data) => {
    buffer += decoder.write(data);
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

async function buildDriver(): Promise<void> {
  const { Builder } = require('selenium-webdriver');
  // selenium-webdriver expects 'MicrosoftEdge' for Edge, not 'edge'.
  const seleniumBrowserName = browserName === 'edge' ? 'MicrosoftEdge' : browserName;
  const builder = new Builder().forBrowser(seleniumBrowserName);

  if (browserName === 'chrome') {
    const chromeArgs: string[] = [];
    if (!headed && !cdpEndpoint) {
      chromeArgs.push('--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu');
    }
    if (profilePath) chromeArgs.push(`--user-data-dir=${profilePath}`);
    const chromeOpts: any = { args: chromeArgs };
    if (cdpEndpoint) chromeOpts.debuggerAddress = cdpEndpoint;
    // Allow overriding the Chrome binary path via env var (useful in CI).
    if (process.env.SE_CHROME_BINARY) chromeOpts.binary = process.env.SE_CHROME_BINARY;
    builder.getCapabilities().set('goog:chromeOptions', chromeOpts);
  } else if (browserName === 'edge') {
    const edgeArgs: string[] = [];
    if (!headed) {
      edgeArgs.push('--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu');
    }
    if (profilePath) edgeArgs.push(`--user-data-dir=${profilePath}`);
    const edgeOpts: any = { args: edgeArgs };
    if (cdpEndpoint) edgeOpts.debuggerAddress = cdpEndpoint;
    if (process.env.SE_EDGE_BINARY) edgeOpts.binary = process.env.SE_EDGE_BINARY;
    builder.getCapabilities().set('ms:edgeOptions', edgeOpts);
  } else if (browserName === 'firefox') {
    const firefoxOpts: any = {};
    if (!headed) {
      firefoxOpts.args = ['-headless'];
    }
    if (profilePath) firefoxOpts.profile = profilePath;
    // Allow overriding the Firefox binary path via env var (useful in CI
    // where browser-actions/setup-firefox installs to a non-standard path).
    if (process.env.SE_FIREFOX_BINARY) firefoxOpts.binary = process.env.SE_FIREFOX_BINARY;
    builder.getCapabilities().set('moz:firefoxOptions', firefoxOpts);
  }

  // Add a timeout so builder.build() doesn't hang indefinitely if
  // the browser driver process stalls.
  const buildPromise = builder.build();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out building ${browserName} driver after 60s`)), 60000);
  });
  driver = await Promise.race([buildPromise, timeoutPromise]);
  driverInitError = null;
}

async function handleMessage(msg: ClientMessage): Promise<ServerMessage> {
  if (msg.method === 'ping') {
    // If the driver previously crashed, report it so the client can
    // restart the daemon rather than sending commands to a dead session.
    if (driverInitError) {
      return { ok: false, error: driverInitError, code: 'DRIVER_ERROR' };
    }
    return { ok: true, text: 'pong' };
  }
  // method === 'run' — dispatch to backend
  const { callTool, parseCommand } = require('./backend');
  try {
    // Parse the command first so we can skip driver initialization for
    // config commands that don't need a browser.
    const { toolName, toolParams, flags } = parseCommand(msg.params.args);
    const isConfigCmd = toolName === 'config_get' || toolName === 'config_set' ||
      toolName === 'config_list' || toolName === 'config_init';
    if (!isConfigCmd && !driver) {
      // Clear any previous init error and attempt a fresh build.
      // The initial build might have failed due to a transient issue
      // (e.g. chromedriver DLL init failure 0xC0000142 on Windows CI),
      // but subsequent commands deserve a retry rather than being
      // permanently blocked by the cached error.
      driverInitError = null;
      try {
        await buildDriver();
      } catch (e: any) {
        driverInitError = `Failed to build ${browserName} driver: ${e.message}`;
        process.stderr.write(driverInitError + '\n' + (e.stack || '') + '\n');
        return { ok: false, error: driverInitError, code: 'DRIVER_ERROR' };
      }
    }
    const response = await callTool(driver, toolName, toolParams, { raw: !!msg.params.raw, json: !!msg.params.json }, flags, msg.params.cwd);
    return { ok: true, text: response.serialize() };
  } catch (e: any) {
    let code: ServerMessage['code'] = 'DRIVER_ERROR';
    const name = e.name || '';
    if (name === 'NoSuchElementError' || name === 'StaleElementReferenceError') code = 'ELEMENT_NOT_FOUND';
    else if (name === 'TimeoutError') code = 'TIMEOUT';
    // Reset the driver on fatal errors so the next command can rebuild
    // a fresh driver instead of reusing a crashed/stale session. This is
    // the primary fix for Chrome flaky tests: when the browser crashes
    // mid-command (e.g. 0xC0000142, WebDriver session not found), the
    // stale driver object would cause ALL subsequent commands to fail.
    if (code === 'DRIVER_ERROR' || code === 'TIMEOUT') {
      process.stderr.write(`Resetting driver after ${code}: ${e.message}\n`);
      try { if (driver) driver.quit(); } catch {}
      driver = null;
      driverInitError = null;
    }
    return { ok: false, error: e.message, code };
  }
}

async function shutdown() {
  // Close the server first so no new connections are accepted.
  server.close();
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch {}
  }
  // Quit the driver with a timeout — if it hangs, we still exit.
  try {
    await Promise.race([
      driver ? driver.quit() : Promise.resolve(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('driver quit timeout')), 5000)),
    ]);
  } catch (e: any) {
    process.stderr.write(`driver quit failed: ${e.message}\n`);
  }
  // NOTE: Do NOT delete the session file here.  The CLI's stop() method
  // handles session file cleanup AFTER the daemon has exited.  If the
  // daemon deletes the file during shutdown(), it may race with a new
  // daemon that has already written its own session file, causing the
  // "list" command to return empty results.
  process.exit(0);
}

// Catch uncaught exceptions so the daemon doesn't silently crash.
// Try to send an error response to the client. For errors that occur
// during driver operations, reset the driver so the next command can
// attempt to rebuild it rather than killing the daemon entirely.
process.on('uncaughtException', (err: Error) => {
  // Silently ignore EPIPE/ECONNRESET — these happen when the parent
  // process closes its end of the stdio pipe after the daemon starts.
  const msg = err.message || '';
  if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('write EPIPE')) {
    return;
  }
  process.stderr.write(`Uncaught exception: ${err.message}\n${err.stack || ''}\n`);
  if (activeSocket && !activeSocket.destroyed) {
    try {
      const errResp: ServerMessage = { ok: false, error: `daemon crash: ${err.message}`, code: 'DRIVER_ERROR' };
      activeSocket.write(JSON.stringify(errResp) + '\n');
      activeSocket.end();
    } catch {}
  }
  // Reset driver state so subsequent commands can try to rebuild.
  // Only exit if the error is not driver-related (e.g. out of memory).
  const isDriverError = msg.includes('driver') || msg.includes('WebDriver') ||
    msg.includes('Session') || msg.includes('geckodriver') || msg.includes('chromedriver');
  if (isDriverError) {
    try { if (driver) driver.quit(); } catch {}
    driver = null;
    driverInitError = null;
  } else {
    shutdown();
  }
});

// Catch unhandled promise rejections — same strategy as uncaught exceptions.
process.on('unhandledRejection', (err: any) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('write EPIPE')) {
    return;
  }
  process.stderr.write(`Unhandled rejection: ${msg}\n${err instanceof Error ? err.stack || '' : ''}\n`);
  if (activeSocket && !activeSocket.destroyed) {
    try {
      const errResp: ServerMessage = { ok: false, error: `daemon rejection: ${msg}`, code: 'DRIVER_ERROR' };
      activeSocket.write(JSON.stringify(errResp) + '\n');
      activeSocket.end();
    } catch {}
  }
  const isDriverError = msg.includes('driver') || msg.includes('WebDriver') ||
    msg.includes('Session') || msg.includes('geckodriver') || msg.includes('chromedriver');
  if (isDriverError) {
    try { if (driver) driver.quit(); } catch {}
    driver = null;
    driverInitError = null;
  } else {
    shutdown();
  }
});

// Prevent broken-pipe errors on stdout/stderr from crashing the daemon.
// After the parent process unrefs the stdio pipes, writes may fail with
// EPIPE.  Swallow these errors so the daemon stays alive.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  if (Date.now() - lastActivity > 30 * 60 * 1000) shutdown();
}, 60 * 1000);

// Heartbeat: periodically check driver health via getTitle().
// If the driver is dead (browser crash, session expired), reset it so
// the next client command can rebuild rather than using a stale driver.
// Uses a 2-strike policy to avoid false positives from transient issues
// like page navigation or slow script execution.
let heartbeatFailures = 0;
setInterval(async () => {
  if (!driver) return;
  try {
    await driver.getTitle();
    heartbeatFailures = 0;
  } catch (e: any) {
    heartbeatFailures++;
    process.stderr.write(`heartbeat failed (${heartbeatFailures}): ${e.message}\n`);
    if (heartbeatFailures >= 2) {
      process.stderr.write('driver appears dead — resetting for rebuild\n');
      try { if (driver) driver.quit(); } catch {}
      driver = null;
      driverInitError = null;
      heartbeatFailures = 0;
    }
  }
}, 30 * 1000);

const config: SessionConfig = {
  name: sessionName,
  version,
  timestamp: Date.now(),
  socketPath,
  workspaceDir,
  persistent,
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

// Pre-build the driver BEFORE listening so the first client command doesn't
// have to wait for driver initialization.  On Windows CI, the first Chrome
// driver build can take >30s (Selenium Manager downloads the driver), which
// exceeds the client's sendAndClose timeout and causes spurious failures.
// If the build fails, we still start listening — the error is reported to
// the client on their first command via driverInitError.
(async () => {
  try {
    await buildDriver();
  } catch (e: any) {
    driverInitError = `Failed to build ${browserName} driver: ${e.message}`;
    process.stderr.write(driverInitError + '\n' + (e.stack || '') + '\n');
  }
  server.listen(socketPath, () => {
    console.log(`Daemon listening on ${socketPath}`);
  });
})();
