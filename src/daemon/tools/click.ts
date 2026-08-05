import { Response } from '../../response';
import { findElementWithWait } from './shared';
import { codegenBy } from './locator';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_click(driver: any, params: { target: string; locatorStyle?: string; _wait?: WaitConfig }, response: Response): Promise<void> {
  // v0.4: locate the element with wait (polls until it appears in the DOM),
  // then wait for the desired state before clicking.
  const el = await findElementWithWait(driver, params.target, params._wait);

  // v0.4: wait for element to reach desired state before clicking
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  // v0.9: role-based codegen (--locator-style=role|css|ref, default role).
  // Capture the code BEFORE clicking: a click may navigate away (e.g. a
  // link), which stales the element and breaks the locator scripts.
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  await el.click();
  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(`await driver.findElement(${code.expression}).click();`);
  response.addResult('clicked');
}
