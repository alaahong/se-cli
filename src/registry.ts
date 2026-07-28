import * as fs from 'fs';
import * as path from 'path';

export interface SessionConfig {
  name: string;
  version: string;
  timestamp: number;
  socketPath: string;
  workspaceDir: string;
  persistent: boolean;
  browserName: 'chrome' | 'edge' | 'firefox';
}

export class Registry {
  constructor(private baseDir: string) {}

  private sessionFile(wsHash: string, sessionName: string): string {
    return path.join(this.baseDir, wsHash, `${sessionName}.session`);
  }

  writeSession(wsHash: string, config: SessionConfig): void {
    const file = this.sessionFile(wsHash, config.name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
  }

  loadSession(wsHash: string, sessionName: string): SessionConfig | null {
    const file = this.sessionFile(wsHash, sessionName);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data as SessionConfig;
    } catch {
      return null;
    }
  }

  listSessions(wsHash: string): SessionConfig[] {
    const dir = path.join(this.baseDir, wsHash);
    if (!fs.existsSync(dir)) return [];
    const sessions: SessionConfig[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.session')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        sessions.push(data as SessionConfig);
      } catch {
        // skip invalid files
      }
    }
    return sessions;
  }

  deleteSession(wsHash: string, sessionName: string): void {
    const file = this.sessionFile(wsHash, sessionName);
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}
