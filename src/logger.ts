/**
 * File logging for the se-cli process tree.
 *
 * The daemon and MCP server run without a console of their own: the daemon's
 * stdio pipes are unref'd by the CLI after startup (their output would be
 * silently dropped), and the MCP server's stdout is reserved for the JSON-RPC
 * protocol. This module provides a minimal, dependency-free file logger used
 * by the CLI, daemon, and MCP server.
 *
 * Design notes:
 *  - Synchronous appends (fs.appendFileSync): the daemon's event loop must
 *    never block on logging backpressure, and log volume is low.
 *  - Size-based rotation: when the active file exceeds MAX_BYTES it is rolled
 *    to `<name>.1`, `<name>.2` (older backups are dropped).
 *  - Levels: error > warn > info > debug. Default level is info; the
 *    SE_CLI_LOG_LEVEL env var (or the optional constructor arg) can raise or
 *    lower it. Filters below the level are skipped before any I/O happens.
 *  - installStderrRedirect()/installConsoleRedirect() capture output from
 *    code that writes to process.stderr / console.* (including uncaught
 *    exception handlers and third-party modules) without wrapping every
 *    call site.
 */

import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB per file
const MAX_BACKUPS = 2;

function parseLevel(level: string | undefined, fallback: LogLevel): LogLevel {
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  return fallback;
}

function formatLine(level: LogLevel, ctx: string, msg: string): string {
  const ts = new Date().toISOString();
  return `${ts} [${level.toUpperCase()}] [${ctx}] ${msg}\n`;
}

export class FileLogger {
  private filePath: string;
  private level: LogLevel;

  constructor(
    dir: string,
    fileName: string,
    options: { level?: LogLevel } = {},
  ) {
    this.filePath = path.join(dir, fileName);
    this.level = options.level ?? parseLevel(process.env.SE_CLI_LOG_LEVEL, 'info');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Logging must never crash the daemon — skip setup if the dir is
      // unavailable (e.g. mocked paths in tests).
    }
  }

  get path(): string {
    return this.filePath;
  }

  debug(ctx: string, msg: string): void { this.write('debug', ctx, msg); }
  info(ctx: string, msg: string): void { this.write('info', ctx, msg); }
  warn(ctx: string, msg: string): void { this.write('warn', ctx, msg); }
  error(ctx: string, msg: string): void { this.write('error', ctx, msg); }

  private write(level: LogLevel, ctx: string, msg: string): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.filePath, formatLine(level, ctx, msg));
    } catch {
      // Logging must never crash the daemon — drop the entry silently.
    }
  }

  /**
   * Roll the active file once it exceeds MAX_BYTES. Backups are shifted:
   * `file` → `file.1`, `file.1` → `file.2`; any `.2` beyond MAX_BACKUPS is
   * removed.
   */
  private rotateIfNeeded(): void {
    let size = 0;
    try { size = fs.statSync(this.filePath).size; } catch {
      return; // file does not exist yet
    }
    if (size < DEFAULT_MAX_BYTES) return;
    try {
      const backup2 = `${this.filePath}.${MAX_BACKUPS}`;
      if (fs.existsSync(backup2)) fs.unlinkSync(backup2);
      for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
        const src = `${this.filePath}.${i}`;
        if (fs.existsSync(src)) fs.renameSync(src, `${this.filePath}.${i + 1}`);
      }
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    } catch {
      // Rotation is best-effort; keep writing to the same file if it fails.
    }
  }

  /**
   * Redirect process.stderr into the log file (prefixed with the message as-is).
   * Used by the daemon so that every diagnostic write — including uncaught
   * exception handlers and driver output — lands in the file. The original
   * stderr is preserved so callers that genuinely need it can still use it.
   */
  installStderrRedirect(): void {
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any, ...args: any[]): boolean => {
      this.info('stderr', String(chunk).trimEnd());
      return origWrite(chunk, ...args);
    }) as typeof process.stderr.write;
  }

  /**
   * Redirect console.log/error/warn into the log file. Used by the MCP server
   * where stdout is reserved for JSON-RPC and most MCP clients never surface
   * stderr. The original console methods are preserved for callers that opt
   * out.
   */
  installConsoleRedirect(): void {
    const origLog = console.log.bind(console);
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.log = ((...args: any[]): void => {
      this.info('console', formatArgs(args));
      origLog(...args);
    }) as typeof console.log;
    console.error = ((...args: any[]): void => {
      this.error('console', formatArgs(args));
      origError(...args);
    }) as typeof console.error;
    console.warn = ((...args: any[]): void => {
      this.warn('console', formatArgs(args));
      origWarn(...args);
    }) as typeof console.warn;
  }
}

function formatArgs(args: any[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
