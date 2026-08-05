import { Response } from '../../response';
import { findElementWithWait } from './shared';
import { codegenBy } from './locator';
import { waitForElementState, type WaitConfig } from '../../wait-config';

async function emitCheckCode(
  driver: any,
  el: any,
  params: { target: string; locatorStyle?: string },
  response: Response,
  action: 'check' | 'uncheck'
): Promise<void> {
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(
    action === 'check'
      ? `const el = driver.findElement(${code.expression}); if (!(await el.isSelected())) await el.click();`
      : `const el = driver.findElement(${code.expression}); if (await el.isSelected()) await el.click();`
  );
}

export async function browser_check(driver: any, params: { target: string; locatorStyle?: string; _wait?: WaitConfig }, response: Response): Promise<void> {
  // v0.4: locate the element with wait (polls until it appears in the DOM)
  const el = await findElementWithWait(driver, params.target, params._wait);

  // v0.4: wait for element to reach desired state before checking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  if (!(await el.isSelected())) await el.click();
  await emitCheckCode(driver, el, params, response, 'check');
  response.addResult('checked');
}

export async function browser_uncheck(driver: any, params: { target: string; locatorStyle?: string; _wait?: WaitConfig }, response: Response): Promise<void> {
  // v0.4: locate the element with wait (polls until it appears in the DOM)
  const el = await findElementWithWait(driver, params.target, params._wait);

  // v0.4: wait for element to reach desired state before unchecking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  if (await el.isSelected()) await el.click();
  await emitCheckCode(driver, el, params, response, 'uncheck');
  response.addResult('unchecked');
}
