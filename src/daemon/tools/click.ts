import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_click(driver: any, params: { target: string; _wait?: WaitConfig }, response: Response): Promise<void> {
  const el = await findElement(driver, params.target);

  // v0.4: wait for element to reach desired state before clicking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  await el.click();
  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.findElement(${byToString(params.target)}).click();`);
  response.addResult('clicked');
}
