import { Response } from '../../response';
import { findElement } from './shared';
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
  const el = await findElement(driver, params.target);

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
  const el = await findElement(driver, params.target);

  // v0.4: wait for element to reach desired state before unchecking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  if (await el.isSelected()) await el.click();
  await emitCheckCode(driver, el, params, response, 'uncheck');
  response.addResult('unchecked');
}
