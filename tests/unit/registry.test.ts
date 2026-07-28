import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Registry, SessionConfig } from '../../src/registry';

describe('Registry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a session file', () => {
    const reg = new Registry(tmpDir);
    const config: SessionConfig = {
      name: 'default',
      version: '0.1.0',
      timestamp: Date.now(),
      socketPath: '/tmp/test.sock',
      workspaceDir: '/tmp',
      persistent: false,
      browserName: 'chrome',
    };
    reg.writeSession('ws-hash', config);
    const loaded = reg.loadSession('ws-hash', 'default');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('default');
    expect(loaded!.socketPath).toBe('/tmp/test.sock');
  });

  it('lists sessions in a workspace', () => {
    const reg = new Registry(tmpDir);
    reg.writeSession('ws-hash', { name: 'default', version: '0.1.0', timestamp: 1, socketPath: '/a', workspaceDir: '/tmp', persistent: false, browserName: 'chrome' });
    reg.writeSession('ws-hash', { name: 'extra', version: '0.1.0', timestamp: 2, socketPath: '/b', workspaceDir: '/tmp', persistent: false, browserName: 'chrome' });
    const sessions = reg.listSessions('ws-hash');
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.name).sort()).toEqual(['default', 'extra']);
  });

  it('deletes a session file', () => {
    const reg = new Registry(tmpDir);
    reg.writeSession('ws-hash', { name: 'default', version: '0.1.0', timestamp: 1, socketPath: '/a', workspaceDir: '/tmp', persistent: false, browserName: 'chrome' });
    reg.deleteSession('ws-hash', 'default');
    const loaded = reg.loadSession('ws-hash', 'default');
    expect(loaded).toBeNull();
  });

  it('returns null for missing session', () => {
    const reg = new Registry(tmpDir);
    expect(reg.loadSession('ws-hash', 'nonexistent')).toBeNull();
  });
});
