import { Response } from '../../response';
import { generateAriaSnapshotScript } from '../../snapshot/aria-snapshot';
import { safeFilename } from './shared';
import * as fs from 'fs';
import * as path from 'path';

export async function browser_snapshot(
  driver: any,
  params: { target?: string; depth?: number; filename?: string },
  response: Response
): Promise<void> {
  const script = generateAriaSnapshotScript();
  let yaml = '';

  // Wait for the page body to have content before generating the snapshot.
  // readyState 'complete' doesn't guarantee the DOM is fully rendered.
  if (!params.target) {
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
  }

  // Retry up to 3 times — the page may still be loading and
  // executeScript can return empty on the first attempt.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await driver.executeScript(
        `const options = { target: arguments[0], depth: arguments[1] }; return (${script})(options);`,
        params.target || null,
        params.depth !== undefined ? params.depth : 50,
      );
      yaml = typeof result === 'string' ? result : '';
      if (yaml) break;
      await new Promise(r => setTimeout(r, 500));
    } catch (e: any) {
      if (attempt === 2) {
        response.addError(`Failed to generate snapshot: ${e.message}`);
        return;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!yaml) {
    response.addError('Snapshot returned empty result — the page may not have loaded yet.');
    return;
  }

  if (params.filename) {
    const outDir = path.join(process.cwd(), '.se-cli');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, safeFilename(params.filename));
    fs.writeFileSync(file, yaml);
    response.addResult(`[Snapshot](.se-cli/${params.filename})`);
  } else {
    response.addResult(yaml);
  }
}
