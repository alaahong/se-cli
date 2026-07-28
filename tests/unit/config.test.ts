import { describe, it, expect } from 'vitest';
import { makeSocketPath, workspaceHash, userHash, defaultSessionName } from '../../src/config';

describe('config', () => {
  it('userHash is 8 chars hex', () => {
    const hash = userHash();
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it('workspaceHash is 16 chars hex', () => {
    const hash = workspaceHash('/some/path');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('workspaceHash is deterministic', () => {
    expect(workspaceHash('/some/path')).toBe(workspaceHash('/some/path'));
  });

  it('workspaceHash differs for different paths', () => {
    expect(workspaceHash('/path/a')).not.toBe(workspaceHash('/path/b'));
  });

  it('defaultSessionName is "default"', () => {
    expect(defaultSessionName).toBe('default');
  });

  it('makeSocketPath contains identifiers', () => {
    const path = makeSocketPath('ws-hash', 'mysession');
    // Windows uses named pipe prefix `se-cli`, POSIX uses flat `se-cli`.
    expect(path).toMatch(/se(lenium)?-cli/);
    expect(path).toContain('mysession');
    expect(path).toContain('ws-hash');
  });
});
