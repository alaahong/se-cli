import { Response } from '../../response';
import { browser_snapshot } from './snapshot';

export async function browser_find(
  driver: any,
  params: { text?: string; regex?: string },
  response: Response
): Promise<void> {
  // Reuse browser_snapshot to generate the YAML, so find and snapshot
  // always share the exact same executeScript code path.
  const snapshotResponse = new Response({ raw: true, json: false });
  await browser_snapshot(driver, {}, snapshotResponse);
  const yaml = snapshotResponse.serialize();

  const lines = yaml.split('\n');
  const matches: string[] = [];

  if (params.regex) {
    let pattern = params.regex;
    let flags = '';
    const slashMatch = pattern.match(/^\/(.+)\/([gimuy]*)$/);
    if (slashMatch) {
      pattern = slashMatch[1];
      flags = slashMatch[2];
    }
    const re = new RegExp(pattern, flags);
    lines.forEach((line, i) => {
      if (re.test(line)) {
        const start = Math.max(0, i - 3);
        const end = Math.min(lines.length, i + 4);
        matches.push(...lines.slice(start, end), '---');
      }
    });
  } else if (params.text) {
    lines.forEach((line, i) => {
      if (line.includes(params.text!)) {
        const start = Math.max(0, i - 3);
        const end = Math.min(lines.length, i + 4);
        matches.push(...lines.slice(start, end), '---');
      }
    });
  }

  response.addResult(matches.join('\n'));
}
