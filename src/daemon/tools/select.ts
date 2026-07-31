import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_select(
  driver: any,
  params: { target: string; value: string; _wait?: WaitConfig },
  response: Response
): Promise<void> {
  const el = await findElement(driver, params.target);

  // v0.4: wait for element to reach desired state before selecting
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  const { Select } = require('selenium-webdriver');
  const select = new Select(el);
  await select.selectByVisibleText(params.value);
  response.addCode(`const select = new Select(driver.findElement(${byToString(params.target)})); await select.selectByVisibleText('${params.value}');`);
  response.addResult(`selected ${params.value}`);
}
