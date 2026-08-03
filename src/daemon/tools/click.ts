import { Response } from '../../response';
import { findElement } from './shared';
import { codegenBy } from './locator';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_click(driver: any, params: { target: string; locatorStyle?: string; _wait?: WaitConfig }, response: Response): Promise<void> {
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
  // v0.9: role-based codegen (--locator-style=role|css|ref, default role)
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(`await driver.findElement(${code.expression}).click();`);
  response.addResult('clicked');
}
