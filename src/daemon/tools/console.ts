/**
 * v0.7: Console log capture command.
 *
 * Captures browser console messages (console.log/error/warn/info) and
 * JavaScript exceptions via BiDi log.entryAdded events. Messages are
 * buffered in the daemon from session start.
 *
 * Usage:
 *   console                    — all messages since session start
 *   console error              — only error-level messages
 *   console --since=5m         — only messages from the last 5 minutes
 *   console --clear            — clear the buffer after output
 *   console js-error           — only JS exceptions
 */

import { Response } from '../../response';
import {
  ensureBidiInitialized,
  getConsoleEntries,
  clearConsole,
  type ConsoleEntry,
} from './network-state';

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/i);
  if (!match) throw new Error(`Invalid --since duration: ${duration}. Use format like 30s, 5m, 1h`);
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

function formatConsoleEntry(entry: ConsoleEntry, truncate: number = 200): string {
  const level = entry.level.toUpperCase().padEnd(7);
  let text = entry.text;
  if (text.length > truncate) {
    text = text.slice(0, truncate) + '...';
  }
  return `[${level}] ${text}`;
}

export async function browser_console(
  driver: any,
  params: {
    level?: string;      // 'error' | 'warning' | 'info' | 'verbose' (from positional)
    since?: string;      // '5m', '30s', '1h'
    clear?: boolean;     // clear buffer after output
  },
  response: Response,
): Promise<void> {
  await ensureBidiInitialized(driver);

  // Determine filter level
  let level: string | undefined;
  let jsErrorOnly = false;

  if (params.level) {
    const lv = params.level.toLowerCase();
    if (lv === 'js-error') {
      jsErrorOnly = true;
    } else if (['verbose', 'debug', 'info', 'warning', 'error'].includes(lv)) {
      level = lv;
    } else {
      throw new Error(`Unknown console level: ${params.level}. Supported: verbose, info, warning, error, js-error`);
    }
  }

  // Parse --since duration
  let sinceMs: number | undefined;
  if (params.since) {
    sinceMs = parseDurationToMs(params.since);
  }

  // Get entries
  let entries = getConsoleEntries(level, sinceMs);

  if (jsErrorOnly) {
    entries = entries.filter(e => e.source === 'javascriptException');
  }

  // Format output
  if (entries.length === 0) {
    response.addResult('(no console messages)');
  } else {
    const lines = entries.map(e => formatConsoleEntry(e));
    response.addResult(lines.join('\n'));
  }

  // Clear buffer if requested
  if (params.clear) {
    clearConsole();
  }

  response.addCode(`// console${params.level ? ' ' + params.level : ''}${params.clear ? ' --clear' : ''}`);
}
