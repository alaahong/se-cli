import { Response } from '../../response';
import { findElement, findElementWithWait, byToString } from './shared';
import { codegenBy } from './locator';
import { waitForElementState, type WaitConfig } from '../../wait-config';

/**
 * hover <ref> — mouse hover via driver.actions().move()
 */
export async function browser_hover(
  driver: any,
  params: { target: string; locatorStyle?: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const el = await findElementWithWait(driver, params.target, params._wait);

  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  const actions = driver.actions();
  await actions.move({ origin: el }).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(`const el = await driver.findElement(${code.expression});\nawait driver.actions().move({ origin: el }).perform();`);
  response.addResult('hovered');
}

/**
 * dblclick <ref> — double-click via driver.actions().doubleClick()
 */
export async function browser_dblclick(
  driver: any,
  params: { target: string; locatorStyle?: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const el = await findElementWithWait(driver, params.target, params._wait);

  if (params._wait) {
    const waitCode = await waitForElementState(driver, el, params._wait.state, params._wait.timeout);
    if (waitCode) response.addCode(waitCode);
  }

  const actions = driver.actions();
  await actions.doubleClick(el).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  const code = await codegenBy(driver, el, params.locatorStyle || 'role', params.target);
  if (code.note) response.addCode(`// ${code.note}`);
  response.addCode(`const el = await driver.findElement(${code.expression});\nawait driver.actions().doubleClick(el).perform();`);
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

  const actions = driver.actions();
  await actions.dragAndDrop(startEl, endEl).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`const src = await driver.findElement(${byToString(params.start)});\nconst dst = await driver.findElement(${byToString(params.end)});\nawait driver.actions().dragAndDrop(src, dst).perform();`);
  response.addResult('dragged');
}
