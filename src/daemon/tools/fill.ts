import { Response } from '../../response';
import { findElementWithWait } from './shared';
import { codegenBy } from './locator';
import { Key } from 'selenium-webdriver';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_fill(
  driver: any,
  params: { target: string; value: string; submit?: boolean; locatorStyle?: string; _wait?: WaitConfig },
  response: Response
): Promise<void> {
  // v0.4: locate the element with wait (polls until it appears in the DOM)
  const el = await findElementWithWait(driver, params.target, params._wait);

  // v0.4: wait for element to reach desired state before filling
  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  // clear() can throw "invalid element state" on some inputs (e.g. React
  // controlled inputs that aren't fully editable yet). Fall back to a
  // select-all + delete sequence so we don't block on stubborn elements.
  try {
    await el.clear();
  } catch {
    await el.sendKeys(Key.CONTROL, 'a', Key.NULL);
    await el.sendKeys(Key.DELETE);
  }
  // v0.9: role-based codegen (--locator-style=role|css|ref, default role).
  // Capture the code BEFORE the action: `--submit` may navigate away (form
  // submission), which stales the element and breaks the locator scripts.
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  await el.sendKeys(params.value);
  if (params.submit) {
    await el.sendKeys(Key.ENTER);
  }
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(`await driver.findElement(${code.expression}).sendKeys('${params.value}');`);
  response.addResult('filled');
}
