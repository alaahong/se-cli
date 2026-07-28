import { Response } from '../../response';
import { generateAriaSnapshotScript } from '../../snapshot/aria-snapshot';

export async function browser_find(
  driver: any,
  params: { text?: string; regex?: string },
  response: Response
): Promise<void> {
  // Call executeScript directly to get the snapshot YAML, sharing the
  // exact same script generation code as browser_snapshot.
  const script = generateAriaSnapshotScript();
  const yaml: string = await driver.executeScript(`
    const options = { target: arguments[0], depth: arguments[1] };
    return (${script})(options);
  `, null, 50);

  const lines = (yaml || '').split('\n');
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

  if (matches.length === 0) {
    response.addResult('No matches found.');
  } else {
    response.addResult(matches.join('\n'));
  }
}
