import { Response } from '../../response';
import { generateAriaSnapshotScript } from '../../snapshot/aria-snapshot';
import * as fs from 'fs';
import * as path from 'path';

export async function browser_snapshot(
  driver: any,
  params: { target?: string; depth?: number; filename?: string },
  response: Response
): Promise<void> {
  const script = generateAriaSnapshotScript();
  const yaml: string = await driver.executeScript(`
    return (${script})(${JSON.stringify({ target: arguments[0], depth: arguments[1] })});
  `, params.target || null, params.depth || 50);

  if (params.filename) {
    const outDir = path.join(process.cwd(), '.selenium-cli');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, params.filename);
    fs.writeFileSync(file, yaml);
    response.addResult(`[Snapshot](.selenium-cli/${params.filename})`);
  } else {
    response.addResult(yaml);
  }
}
