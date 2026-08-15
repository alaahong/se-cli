import { Response } from '../../response';
import { findElementWithWait, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';
import * as path from 'path';

/**
 * upload <ref> <file> [--bidi] — file upload.
 *
 * Default path: `el.sendKeys(absolutePath)` (W3C Classic, works everywhere).
 * With `--bidi`: WebDriver BiDi `input.setFiles` (Chromium + Firefox), which
 * sets the file input's files directly without relying on clipboard/focus.
 */
export async function browser_upload(
  driver: any,
  params: { target: string; file: string; bidi?: boolean; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  // v0.4: locate the element with wait (polls until it appears in the DOM)
  const el = await findElementWithWait(driver, params.target, params._wait);

  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  // Resolve to absolute path — Selenium expects an absolute file path
  const filePath = path.resolve(params.file);

  if (params.bidi) {
    // BiDi input.setFiles — needs the browsing context id and the element's
    // shared id, then sends the file list directly.
    let bidi: any;
    try {
      bidi = await driver.getBidi();
    } catch (e: any) {
      throw new Error(`Error: upload --bidi requires WebDriver BiDi — this browser/session does not support it (Safari does not): ${e.message}`);
    }
    const context = await driver.getWindowHandle();
    const sharedId = await el.getId();
    const payload = await bidi.send({
      method: 'input.setFiles',
      params: {
        context,
        element: { sharedId },
        files: [filePath],
      },
    });
    if (payload && payload.error) {
      throw new Error(`input.setFiles: ${payload.error.message || JSON.stringify(payload.error)}`);
    }
    response.addCode(`await driver.getBidi().then(b => b.send({ method: 'input.setFiles', params: { context: await driver.getWindowHandle(), element: { sharedId: await el.getId() }, files: [${JSON.stringify(filePath)}] } }));`);
  } else {
    await el.sendKeys(filePath);
    response.addCode(`await driver.findElement(${byToString(params.target)}).sendKeys(${JSON.stringify(filePath)});`);
  }

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addResult(`uploaded: ${filePath}`);
}
