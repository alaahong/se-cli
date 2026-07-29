import * as net from 'net';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Registry, SessionConfig } from './registry';
import { makeSocketPath, workspaceHash, baseDaemonDir } from './config';
import type { ClientMessage, ServerMessage } from './protocol';

export class Session {
  private socketPath: string;
  private wsHash: string;
  private registry: Registry;

  constructor(
    private workspaceDir: string,
    private sessionName: string = 'default',
  ) {
    this.wsHash = workspaceHash(workspaceDir);
    this.socketPath = makeSocketPath(this.wsHash, sessionName);
    this.registry = new Registry(baseDaemonDir());
  }

  async canConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.connect(this.socketPath);
      const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
      sock.once('connect', () => {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
    });
  }

  async startDaemon(opts: { browserName?: string; headed?: boolean; cdpEndpoint?: string } = {}): Promise<void> {
    // If a daemon is already running on this socket, verify it's responsive.
    if (await this.canConnect()) {
      try {
        await this.sendAndClose({ method: 'ping', params: { args: [], cwd: '' } });
        return; // Daemon is alive and responsive
      } catch {
        // Daemon is listening but not responsive — force kill it.
        const config = this.registry.loadSession(this.wsHash, this.sessionName);
        if (config && config.pid) {
          try { process.kill(config.pid, 'SIGKILL'); } catch {}
        }
        this.registry.deleteSession(this.wsHash, this.sessionName);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const browserName = opts.browserName || 'chrome';
    const daemonScript = path.join(__dirname, 'daemon', 'server.js');
    const args = [daemonScript, this.sessionName, this.socketPath, this.workspaceDir, browserName];
    if (opts.headed) args.push('--headed');
    if (opts.cdpEndpoint) args.push(`--cdp=${opts.cdpEndpoint}`);

    const child: ChildProcess = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('daemon start timeout'));
      }, 120000);
      const onStdout = (data: Buffer) => {
        const line = data.toString().trim();
        if (line.startsWith('Daemon listening on')) {
          clearTimeout(timeout);
          // Detach from the child so it survives the parent's exit.
          child.unref();
          // Remove listeners so we don't interfere with the child's lifecycle.
          child.stdout?.removeListener('data', onStdout);
          child.stderr?.removeListener('data', onStderr);
          child.removeListener('error', onError);
          child.removeListener('exit', onExit);
          // Unref the stdio pipes so they don't keep the parent's event
          // loop alive (which would cause execSync-based callers to hang
          // until their timeout).  Do NOT destroy the pipes — destroying
          // them breaks the child's stdout/stderr fd and causes the daemon
          // to crash with EPIPE the next time it tries to log an error.
          const stdoutSock = child.stdout as unknown as { unref?: () => void };
          const stderrSock = child.stderr as unknown as { unref?: () => void };
          stdoutSock.unref?.();
          stderrSock.unref?.();
          resolve();
        }
      };
      const onStderr = (data: Buffer) => {
        process.stderr.write(`daemon stderr: ${data}`);
      };
      const onError = (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeout);
        reject(new Error(`daemon exited early code=${code} signal=${signal}`));
      };
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('error', onError);
      child.on('exit', onExit);
    });

    // Health check: verify the daemon is actually responsive by sending a ping.
    // The daemon might crash shortly after listening (e.g., during module
    // loading), so we confirm it can handle at least one request.
    try {
      await this.sendAndClose({ method: 'ping', params: { args: [], cwd: '' } });
    } catch {
      // Ping failed — the daemon may have crashed. Try one more time with
      // a short delay to give it a chance to fully initialize.
      await new Promise(r => setTimeout(r, 500));
      await this.sendAndClose({ method: 'ping', params: { args: [], cwd: '' } });
    }
  }

  async run(args: string[], cwd: string, opts: { raw?: boolean; json?: boolean } = {}): Promise<ServerMessage> {
    const msg: ClientMessage = {
      method: 'run',
      params: { args, cwd, raw: opts.raw, json: opts.json },
    };
    // Retry on connection failures — the daemon may have crashed and
    // needs to be restarted from the saved session config.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.sendAndClose(msg);
      } catch (e: any) {
        lastErr = e;
        const errMsg = e.message || '';
        if (errMsg.includes('daemon closed connection') || errMsg.includes('ECONNREFUSED') || errMsg.includes('connect ENOENT') || errMsg.includes('ECONNRESET') || errMsg.includes('EPIPE')) {
          // Try to restart the daemon on the first connection failure.
          if (attempt === 0) {
            try {
              const config = this.registry.loadSession(this.wsHash, this.sessionName);
              if (config && config.browserName) {
                await this.startDaemon({ browserName: config.browserName });
              }
            } catch {
              // startDaemon may fail — that's OK, we'll retry the connection
            }
          }
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async stop(): Promise<void> {
    try {
      await this.sendAndClose({ method: 'stop', params: { args: [], cwd: process.cwd() } });
    } catch {
      // daemon may already be dead
    }
    this.registry.deleteSession(this.wsHash, this.sessionName);

    // Wait for the daemon to actually exit — the 'stop' response is sent
    // before shutdown() completes, so the socket might still be alive briefly.
    for (let i = 0; i < 10; i++) {
      if (!(await this.canConnect())) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  private sendAndClose(msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      const timeout = setTimeout(() => {
        sock.destroy();
        reject(new Error('daemon connection timeout'));
      }, 60000);

      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        sock.removeAllListeners();
        sock.destroy();
      };

      sock.once('connect', () => {
        sock.write(JSON.stringify(msg) + '\n');
      });

      let buffer = '';
      sock.on('data', (data) => {
        buffer += data.toString();
        if (buffer.includes('\n')) {
          if (settled) return;
          settled = true;
          try {
            const resp = JSON.parse(buffer.split('\n')[0]) as ServerMessage;
            cleanup();
            resolve(resp);
          } catch (e: any) {
            cleanup();
            reject(e);
          }
        }
      });

      sock.once('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });

      sock.once('close', () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (buffer === '' || !buffer.includes('\n')) {
          reject(new Error('daemon closed connection without response'));
        }
      });
    });
  }

  loadConfig(): SessionConfig | null {
    return this.registry.loadSession(this.wsHash, this.sessionName);
  }
}
