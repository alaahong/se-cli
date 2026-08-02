/**
 * Unit tests for src/logger.ts — the shared file logger used by the CLI,
 * daemon, and MCP server.
 *
 * Covers: file creation + line format, level filtering (constructor arg and
 * SE_CLI_LOG_LEVEL), 2MB rotation with 2 backups, stderr redirect (original
 * write preserved), and console redirect (original console preserved).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileLogger } from '../../src/logger';

describe('FileLogger', () => {
  let dir: string;
  let origStderrWrite: typeof process.stderr.write;
  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWarn: typeof console.warn;
  let envLevel: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selog-'));
    origStderrWrite = process.stderr.write;
    origLog = console.log;
    origError = console.error;
    origWarn = console.warn;
    envLevel = process.env.SE_CLI_LOG_LEVEL;
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    if (envLevel === undefined) delete process.env.SE_CLI_LOG_LEVEL;
    else process.env.SE_CLI_LOG_LEVEL = envLevel;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function readLog(name: string): string {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  }

  it('creates the log directory and appends formatted lines', () => {
    const logger = new FileLogger(dir, 'x.log');
    logger.info('ctx', 'hello');
    expect(fs.existsSync(path.join(dir, 'x.log'))).toBe(true);
    expect(readLog('x.log')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] \[ctx\] hello\n$/);
  });

  it('appends multiple entries in call order', () => {
    const logger = new FileLogger(dir, 'x.log');
    logger.info('ctx', 'first');
    logger.error('ctx', 'second');
    const content = readLog('x.log');
    const firstIdx = content.indexOf('first');
    const secondIdx = content.indexOf('second');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('filters below the configured level', () => {
    const logger = new FileLogger(dir, 'x.log', { level: 'warn' });
    logger.debug('d', 'dd');
    logger.info('i', 'ii');
    logger.warn('w', 'ww');
    logger.error('e', 'ee');
    const content = readLog('x.log');
    expect(content).not.toContain('dd');
    expect(content).not.toContain('ii');
    expect(content).toContain('ww');
    expect(content).toContain('ee');
  });

  it('reads the level from SE_CLI_LOG_LEVEL when no arg is given', () => {
    process.env.SE_CLI_LOG_LEVEL = 'error';
    const logger = new FileLogger(dir, 'x.log');
    logger.info('i', 'ignored');
    logger.error('e', 'kept');
    const content = readLog('x.log');
    expect(content).not.toContain('ignored');
    expect(content).toContain('kept');
  });

  it('falls back to info for an invalid SE_CLI_LOG_LEVEL', () => {
    process.env.SE_CLI_LOG_LEVEL = 'verbose';
    const logger = new FileLogger(dir, 'x.log');
    logger.debug('d', 'dd');
    logger.info('i', 'ii');
    const content = readLog('x.log');
    expect(content).not.toContain('dd');
    expect(content).toContain('ii');
  });

  it('the explicit level option beats SE_CLI_LOG_LEVEL', () => {
    process.env.SE_CLI_LOG_LEVEL = 'debug';
    const logger = new FileLogger(dir, 'x.log', { level: 'error' });
    logger.debug('d', 'dd');
    logger.error('e', 'ee');
    const content = readLog('x.log');
    expect(content).not.toContain('dd');
    expect(content).toContain('ee');
  });

  it('rotates the active file past 2MB into .1 and .2 backups', () => {
    const logger = new FileLogger(dir, 'x.log');
    const msg = 'x'.repeat(1000);
    for (let i = 0; i < 2100; i++) logger.info('t', msg);
    // First rotation: active file is fresh (< 2MB), .1 holds the first chunk.
    expect(fs.statSync(path.join(dir, 'x.log')).size).toBeLessThan(2 * 1024 * 1024);
    expect(fs.existsSync(path.join(dir, 'x.log.1'))).toBe(true);
    // Second rotation: .1 shifts to .2, .3 must not exist.
    for (let i = 0; i < 2100; i++) logger.info('t', msg);
    expect(fs.existsSync(path.join(dir, 'x.log.1'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'x.log.2'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'x.log.3'))).toBe(false);
    expect(readLog('x.log.1').length).toBeGreaterThan(0);
    expect(readLog('x.log.2').length).toBeGreaterThan(0);
  });

  it('does not rotate when the file does not exist yet', () => {
    const logger = new FileLogger(dir, 'x.log');
    logger.info('t', 'first');
    logger.info('t', 'second');
    expect(fs.existsSync(path.join(dir, 'x.log.1'))).toBe(false);
    expect(readLog('x.log')).toContain('first');
    expect(readLog('x.log')).toContain('second');
  });

  it('swallows write failures instead of throwing', () => {
    // Occupy the "directory" path with a plain file: mkdirSync and
    // appendFileSync both fail, and the logger must stay silent.
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'occupy');
    const logger = new FileLogger(blocker, 'x.log');
    expect(() => logger.info('t', 'boom')).not.toThrow();
    expect(fs.existsSync(path.join(blocker, 'x.log'))).toBe(false);
  });

  it('installStderrRedirect writes stderr into the file and preserves the original write', () => {
    const logger = new FileLogger(dir, 'x.log');
    const stderrSpy = vi.spyOn(process.stderr, 'write');
    logger.installStderrRedirect();
    process.stderr.write('boom line\n');
    expect(readLog('x.log')).toContain('boom line');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('installConsoleRedirect writes console output into the file and preserves the original methods', () => {
    const logger = new FileLogger(dir, 'x.log');
    const logSpy = vi.spyOn(console, 'log');
    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');
    logger.installConsoleRedirect();
    console.log('a log line');
    console.error('an error');
    console.warn('a warning');
    console.log({ nested: { value: 1 } });
    const content = readLog('x.log');
    expect(content).toContain('a log line');
    expect(content).toContain('an error');
    expect(content).toContain('a warning');
    expect(content).toContain('{"nested":{"value":1}}');
    expect(logSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('path getter returns the joined file path', () => {
    const logger = new FileLogger(dir, 'x.log');
    expect(logger.path).toBe(path.join(dir, 'x.log'));
  });
});
