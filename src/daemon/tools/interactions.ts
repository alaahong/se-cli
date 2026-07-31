import { Response } from '../../response';
import { findElement, findElementWithWait, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';

/**
 * hover <ref> — mouse hover via driver.actions().move()
 */
export async function browser_hover(
  driver: any,
  params: { target: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const el = await findElementWithWait(driver, params.target, params._wait);

  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  const actions = driver.actions({ bridge: true });
  await actions.move({ origin: el }).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().move({ origin: ${byToString(params.target).replace(/By\.css\(|\)/g, '').replace(/'/g, '')} }).perform();`);
  response.addResult('hovered');
}

/**
 * dblclick <ref> — double-click via driver.actions().doubleClick()
 */
export async function browser_dblclick(
  driver: any,
  params: { target: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const el = await findElementWithWait(driver, params.target, params._wait);

  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  const actions = driver.actions({ bridge: true });
  await actions.doubleClick(el).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().doubleClick(${byToString(params.target)}).perform();`);
  response.addResult('double-clicked');
}

/**
 * drag <start> <end> — drag and drop via driver.actions().dragAndDrop()
 */
export async function browser_drag(
  driver: any,
  params: { start: string; end: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const startEl = await findElementWithWait(driver, params.start, params._wait);
  const endEl = await findElementWithWait(driver, params.end, params._wait);

  if (params._wait) {
    const waitCode1 = await waitForElementState(driver, startEl, params._wait.state, params._wait.timeout);
    if (waitCode1) response.addCode(waitCode1);
    const waitCode2 = await waitForElementState(driver, endEl, params._wait.state, params._wait.timeout);
    if (waitCode2) response.addCode(waitCode2);
  }

  const actions = driver.actions({ bridge: true });
  await actions.dragAndDrop(startEl, endEl).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().dragAndDrop(${byToString(params.start)}, ${byToString(params.end)}).perform();`);
  response.addResult('dragged');
}
