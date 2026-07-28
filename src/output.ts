import type { ServerMessage } from './protocol';

export function render(msg: ServerMessage): void {
  if (!msg.ok) {
    process.stderr.write(`Error: ${msg.error || 'unknown'}\n`);
    if (msg.code === 'DAEMON_DEAD') {
      process.stderr.write('Hint: run `selenium-cli open` to start a session.\n');
    } else if (msg.code === 'ELEMENT_NOT_FOUND') {
      process.stderr.write('Hint: run `selenium-cli snapshot` to refresh refs.\n');
    }
    process.exit(1);
  }
  if (msg.text !== undefined) process.stdout.write(msg.text + '\n');
  else if (msg.raw !== undefined) process.stdout.write(msg.raw);
  else if (msg.json !== undefined) process.stdout.write(JSON.stringify(msg.json, null, 2) + '\n');
}
