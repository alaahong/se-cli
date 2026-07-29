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
  try {
    const result = await driver.executeScript(
      `const options = { target: arguments[0], depth: arguments[1] }; return (${script})(options);`,
      params.target || null,
      params.depth || 50,
    );
    yaml = typeof result === 'string' ? result : '';
  } catch (e: any) {
    response.addError(`Failed to generate snapshot: ${e.message}`);
    return;
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
