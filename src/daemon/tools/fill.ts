import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { Key } from 'selenium-webdriver';
import { waitForElementState, type WaitConfig } from '../../wait-config';

export async function browser_fill(
  driver: any,
  params: { target: string; value: string; submit?: boolean; _wait?: WaitConfig },
  response: Response
): Promise<void> {
  const el = await findElement(driver, params.target);

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
  await el.sendKeys(params.value);
  if (params.submit) {
    await el.sendKeys(Key.ENTER);
  }
  response.addCode(`await driver.findElement(${byToString(params.target)}).sendKeys('${params.value}');`);
  response.addResult('filled');
}
