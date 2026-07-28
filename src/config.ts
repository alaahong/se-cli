import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export const defaultSessionName = 'default';

export function userHash(): string {
  const user = process.env.USERNAME || process.env.USER || 'default';
  return crypto.createHash('sha1').update(user).digest('hex').slice(0, 8);
}

export function workspaceHash(workspaceDir: string): string {
  return crypto.createHash('sha1').update(workspaceDir).digest('hex').slice(0, 16);
}

export function makeSocketPath(wsHash: string, sessionName: string): string {
  const uHash = userHash();
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\se-cli-${uHash}-${wsHash}-${sessionName}`;
  }
  // Use a flat path under TMPDIR to avoid:
  //   1. needing to create nested directories before listen(), and
  //   2. exceeding macOS sun_path 104-byte limit on long TMPDIR values.
  const tmpDir = process.env.TMPDIR || '/tmp';
  return path.join(tmpDir, `se-cli-${uHash}-${wsHash}-${sessionName}.sock`);
}

export function baseDaemonDir(): string {
  const cacheDir = process.env.LOCALAPPDATA
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches') : path.join(os.homedir(), '.cache'));
  return path.join(cacheDir, 'ms-se-cli', 'daemon');
}

export function sessionFileDir(wsHash: string): string {
  return path.join(baseDaemonDir(), wsHash);
}

export function sessionFilePath(wsHash: string, sessionName: string): string {
  return path.join(sessionFileDir(wsHash), `${sessionName}.session`);
}

export interface SessionConfig {
  name: string;
  version: string;
  timestamp: number;
  socketPath: string;
  workspaceDir: string;
  persistent: boolean;
  browserName: 'chrome' | 'edge' | 'firefox';
}

export function outputDir(cwd: string): string {
  return path.join(cwd, '.se-cli');
}
