import { Response } from '../../response';
import { generateAriaSnapshotScript } from '../../snapshot/aria-snapshot';

/** Wait for document.body to have at least one child element, then generate snapshot. */
async function getSnapshotYaml(driver: any): Promise<string> {
  const script = generateAriaSnapshotScript();

  // First, wait for the page body to have content. readyState 'complete'
  // doesn't guarantee the DOM is fully rendered (especially for JS-heavy pages).
  try {
    await driver.wait(
      async () => {
        const ready = await driver.executeScript(
          'return document.readyState === "complete" && document.body && document.body.children.length > 0;'
        );
        return ready === true;
      },
      5000,
      'Page body not ready',
    );
  } catch {
    // Continue even if the wait times out — the snapshot may still work.
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await driver.executeScript(
        `const options = { target: arguments[0], depth: arguments[1] }; return (${script})(options);`,
        null,
        50,
      );
      const yaml = typeof result === 'string' ? result : '';
      if (yaml) return yaml;
      // Empty result — the page may not have loaded yet. Wait and retry.
      await new Promise(r => setTimeout(r, 500));
    } catch (e: any) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return '';
}

export async function browser_find(
  driver: any,
  params: { text?: string; regex?: string },
  response: Response
): Promise<void> {
  let yaml: string;
  try {
    yaml = await getSnapshotYaml(driver);
  } catch (e: any) {
    response.addError(`Failed to generate snapshot for find: ${e.message}`);
    return;
  }

  if (!yaml) {
    response.addResult('No matches found.');
    return;
  }

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

  if (matches.length === 0) {
    response.addResult('No matches found.');
  } else {
    response.addResult(matches.join('\n'));
  }
}
