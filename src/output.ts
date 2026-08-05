import type { ServerMessage } from './protocol';

export class CliError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function render(msg: ServerMessage): void {
  if (!msg.ok) {
    let text = `Error: ${msg.error || 'unknown'}\n`;
    if (msg.code === 'DAEMON_DEAD') {
      text += 'Hint: run `se-cli open` to start a session.\n';
    } else if (msg.code === 'ELEMENT_NOT_FOUND') {
      text += 'Hint: run `se-cli snapshot` to refresh refs.\n';
    } else if (msg.code === 'VERSION_MISMATCH') {
      text += 'Hint: run `se-cli close` then `se-cli open` to restart the session with matching versions.\n';
    }
    throw new CliError(text.trim(), msg.code);
  }
  if (msg.text !== undefined) process.stdout.write(msg.text + '\n');
  else if (msg.raw !== undefined) process.stdout.write(msg.raw);
  else if (msg.json !== undefined) process.stdout.write(JSON.stringify(msg.json, null, 2) + '\n');
}
