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
      sock.once('connect', () => { sock.end(); resolve(true); });
      sock.once('error', () => resolve(false));
      setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
    });
  }

  async startDaemon(opts: { browserName?: string; headed?: boolean; cdpEndpoint?: string } = {}): Promise<void> {
    const browserName = opts.browserName || 'chrome';
    const daemonScript = path.join(__dirname, 'daemon', 'server.js');
    const args = [daemonScript, this.sessionName, this.socketPath, this.workspaceDir, browserName];
    if (opts.headed) args.push('--headed');
    if (opts.cdpEndpoint) args.push(`--cdp=${opts.cdpEndpoint}`);

    const child: ChildProcess = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('daemon start timeout')), 30000);
      child.stdout?.on('data', (data) => {
        const line = data.toString().trim();
        if (line.startsWith('Daemon listening on')) {
          clearTimeout(timeout);
          child.unref();
          resolve();
        }
      });
      child.stderr?.on('data', (data) => {
        process.stderr.write(`daemon stderr: ${data}`);
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async run(args: string[], cwd: string, opts: { raw?: boolean; json?: boolean } = {}): Promise<ServerMessage> {
    const msg: ClientMessage = {
      method: 'run',
      params: { args, cwd, raw: opts.raw, json: opts.json },
    };
    return this.sendAndClose(msg);
  }

  async stop(): Promise<void> {
    try {
      await this.sendAndClose({ method: 'stop', params: { args: [], cwd: process.cwd() } });
    } catch {
      // daemon may already be dead
    }
    this.registry.deleteSession(this.wsHash, this.sessionName);
  }

  private sendAndClose(msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      const timeout = setTimeout(() => {
        sock.destroy();
        reject(new Error('daemon connection timeout'));
      }, 30000);

      sock.once('connect', () => {
        sock.write(JSON.stringify(msg) + '\n');
      });

      let buffer = '';
      sock.on('data', (data) => {
        buffer += data.toString();
        if (buffer.includes('\n')) {
          clearTimeout(timeout);
          try {
            const resp = JSON.parse(buffer.split('\n')[0]) as ServerMessage;
            sock.end();
            resolve(resp);
          } catch (e: any) {
            reject(e);
          }
        }
      });

      sock.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  loadConfig(): SessionConfig | null {
    return this.registry.loadSession(this.wsHash, this.sessionName);
  }
}
