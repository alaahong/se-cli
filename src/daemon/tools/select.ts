import { Response } from '../../response';
import { findElementWithWait } from './shared';
import { codegenBy } from './locator';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_select(
  driver: any,
  params: { target: string; value: string; locatorStyle?: string; _wait?: WaitConfig },
  response: Response
): Promise<void> {
  // v0.4: locate the element with wait (polls until it appears in the DOM)
  const el = await findElementWithWait(driver, params.target, params._wait);

  // v0.4: wait for element to reach desired state before selecting
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  const { Select } = require('selenium-webdriver');
  const select = new Select(el);
  await select.selectByVisibleText(params.value);
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(`const select = new Select(driver.findElement(${code.expression})); await select.selectByVisibleText('${params.value}');`);
  response.addResult(`selected ${params.value}`);
}
