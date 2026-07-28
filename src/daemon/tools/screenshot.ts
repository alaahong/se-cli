import { Response } from '../../response';
import { findElement, safeFilename } from './shared';
import * as fs from 'fs';
import * as path from 'path';

export async function browser_screenshot(
  driver: any,
  params: { target?: string; filename?: string },
  response: Response
): Promise<void> {
  let image: Buffer;
  if (params.target) {
    const el = await findElement(driver, params.target);
    image = Buffer.from(await el.takeScreenshot(), 'base64');
  } else {
    image = Buffer.from(await driver.takeScreenshot(), 'base64');
  }

  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `screenshot-${Date.now()}.png`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, image);

  response.addCode(`const image = await driver.takeScreenshot(); fs.writeFileSync('${filename}', Buffer.from(image, 'base64'));`);
  response.addResult(`[Screenshot](.se-cli/${filename})`);
}
