import { Response } from '../../response';
import { findElement, safeFilename } from './shared';
import * as fs from 'fs';
import * as path from 'path';

export async function browser_screenshot(
  driver: any,
  params: { target?: string; filename?: string; bidi?: boolean },
  response: Response
): Promise<void> {
  let image: Buffer;
  if (params.bidi) {
    // v0.13: BiDi browsingContext.captureScreenshot — viewport capture via
    // the BiDi connection (Chromium + Firefox).
    let bidi: any;
    try {
      bidi = await driver.getBidi();
    } catch (e: any) {
      throw new Error(`Error: screenshot --bidi requires WebDriver BiDi — this browser/session does not support it (Safari does not): ${e.message}`);
    }
    const context = await driver.getWindowHandle();
    const payload = await bidi.send({
      method: 'browsingContext.captureScreenshot',
      params: { context, origin: 'viewport' },
    });
    if (payload && payload.error) {
      throw new Error(`browsingContext.captureScreenshot: ${payload.error.message || JSON.stringify(payload.error)}`);
    }
    image = Buffer.from(payload?.result?.data as string, 'base64');
    response.addCode(`const image = await driver.getBidi().then(b => b.send({ method: 'browsingContext.captureScreenshot', params: { context: await driver.getWindowHandle(), origin: 'viewport' } })); fs.writeFileSync('${params.filename ?? 'screenshot.png'}', Buffer.from(image.result.data, 'base64'));`);
  } else if (params.target) {
    const el = await findElement(driver, params.target);
    image = Buffer.from(await el.takeScreenshot(), 'base64');
    response.addCode(`const image = await el.takeScreenshot(); fs.writeFileSync('${params.filename ?? 'screenshot.png'}', Buffer.from(image, 'base64'));`);
  } else {
    image = Buffer.from(await driver.takeScreenshot(), 'base64');
    response.addCode(`const image = await driver.takeScreenshot(); fs.writeFileSync('${params.filename ?? 'screenshot.png'}', Buffer.from(image, 'base64'));`);
  }

  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `screenshot-${Date.now()}.png`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, image);

  response.addResult(`[Screenshot](.se-cli/${filename})`);
}
