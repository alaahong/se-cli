import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_check(driver: any, params: { target: string; _wait?: WaitConfig }, response: Response): Promise<void> {
  const el = await findElement(driver, params.target);

  // v0.4: wait for element to reach desired state before checking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  if (!(await el.isSelected())) await el.click();
  response.addCode(`const el = driver.findElement(${byToString(params.target)}); if (!(await el.isSelected())) await el.click();`);
  response.addResult('checked');
}

export async function browser_uncheck(driver: any, params: { target: string; _wait?: WaitConfig }, response: Response): Promise<void> {
  const el = await findElement(driver, params.target);

  // v0.4: wait for element to reach desired state before unchecking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  if (await el.isSelected()) await el.click();
  response.addCode(`const el = driver.findElement(${byToString(params.target)}); if (await el.isSelected()) await el.click();`);
  response.addResult('unchecked');
}
