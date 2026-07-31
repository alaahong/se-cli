import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';
import * as path from 'path';

/**
 * upload <ref> <file> — file upload via element.sendKeys(filePath)
 */
export async function browser_upload(
  driver: any,
  params: { target: string; file: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const el = await findElement(driver, params.target);

  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  // Resolve to absolute path — Selenium expects an absolute file path
  const filePath = path.resolve(params.file);
  await el.sendKeys(filePath);

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.findElement(${byToString(params.target)}).sendKeys(${JSON.stringify(filePath)});`);
  response.addResult(`uploaded: ${filePath}`);
}
