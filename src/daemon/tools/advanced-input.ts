import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { waitForElementState, type WaitConfig } from '../../wait-config';

/**
 * keydown <key> — press and hold a key via Actions chain
 */
export async function browser_keydown(
  driver: any,
  params: { key: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const actions = driver.actions();
  await actions.keyDown(params.key).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().keyDown(${JSON.stringify(params.key)}).perform();`);
  response.addResult(`keydown: ${params.key}`);
}

/**
 * keyup <key> — release a held key via Actions chain
 */
export async function browser_keyup(
  driver: any,
  params: { key: string; _wait?: WaitConfig },
  response: Response,
): Promise<void> {
  const actions = driver.actions();
  await actions.keyUp(params.key).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().keyUp(${JSON.stringify(params.key)}).perform();`);
  response.addResult(`keyup: ${params.key}`);
}

/**
 * mousemove <x> <y> — move mouse to absolute coordinates
 */
export async function browser_mousemove(
  driver: any,
  params: { x: number; y: number },
  response: Response,
): Promise<void> {
  const actions = driver.actions();
  await actions.move({
    x: params.x,
    y: params.y,
    origin: 'viewport',
  }).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().move({ x: ${params.x}, y: ${params.y}, origin: 'viewport' }).perform();`);
  response.addResult(`moved to (${params.x}, ${params.y})`);
}

/**
 * mousedown [button] — press mouse button (left/right/middle)
 */
export async function browser_mousedown(
  driver: any,
  params: { button?: string },
  response: Response,
): Promise<void> {
  const button = params.button || 'left';
  const actions = driver.actions();
  const buttonValue = getButtonValue(button);
  await actions.press(buttonValue).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().press(${buttonValue}).perform(); // ${button}`);
  response.addResult(`mousedown: ${button}`);
}

/**
 * mouseup [button] — release mouse button (left/right/middle)
 */
export async function browser_mouseup(
  driver: any,
  params: { button?: string },
  response: Response,
): Promise<void> {
  const button = params.button || 'left';
  const actions = driver.actions();
  const buttonValue = getButtonValue(button);
  await actions.release(buttonValue).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().release(${buttonValue}).perform(); // ${button}`);
  response.addResult(`mouseup: ${button}`);
}

/**
 * mousewheel <dx> <dy> — scroll wheel by offsets
 */
export async function browser_mousewheel(
  driver: any,
  params: { dx: number; dy: number },
  response: Response,
): Promise<void> {
  // The Actions API scroll() takes positional args: (x, y, deltaX, deltaY, origin?, duration?)
  // where x,y is the starting viewport coordinate and deltaX/deltaY is the scroll amount.
  const actions = driver.actions();
  await actions.scroll(0, 0, params.dx, params.dy).perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.actions().scroll(0, 0, ${params.dx}, ${params.dy}).perform();`);
  response.addResult(`scrolled (${params.dx}, ${params.dy})`);
}

/**
 * actions-chain — execute a chain of actions in a single perform() call
 * Accepts a JSON array of action steps, e.g.:
 *   [{"type":"move","x":100,"y":100},{"type":"press"},{"type":"release"}]
 */
export async function browser_actions_chain(
  driver: any,
  params: { actions: string },
  response: Response,
): Promise<void> {
  const steps = JSON.parse(params.actions);
  const actions = driver.actions();

  for (const step of steps) {
    switch (step.type) {
      case 'move':
        if (step.target) {
          const el = await findElement(driver, step.target);
          await actions.move({ origin: el, x: step.x || 0, y: step.y || 0 });
        } else {
          await actions.move({ x: step.x || 0, y: step.y || 0, origin: 'viewport' });
        }
        break;
      case 'press':
        await actions.press(step.button ? getButtonValue(step.button) : undefined);
        break;
      case 'release':
        await actions.release(step.button ? getButtonValue(step.button) : undefined);
        break;
      case 'keydown':
        await actions.keyDown(step.key);
        break;
      case 'keyup':
        await actions.keyUp(step.key);
        break;
      case 'click':
        if (step.target) {
          const el = await findElement(driver, step.target);
          await actions.click(el);
        } else {
          await actions.click();
        }
        break;
      case 'doubleClick':
        if (step.target) {
          const el = await findElement(driver, step.target);
          await actions.doubleClick(el);
        } else {
          await actions.doubleClick();
        }
        break;
      case 'scroll':
        await actions.scroll(0, 0, step.x || 0, step.y || 0);
        break;
      case 'pause':
        await actions.pause(step.duration || 100);
        break;
      default:
        throw new Error(`Unknown action type: ${step.type}`);
    }
  }

  await actions.perform();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`// ${steps.length} actions chained into a single perform() call`);
  response.addResult(`performed ${steps.length} chained actions`);
}

/**
 * Map button name to selenium-webdriver Button value.
 */
function getButtonValue(button: string): any {
  const { Button } = require('selenium-webdriver');
  switch (button.toLowerCase()) {
    case 'left':
      return Button.LEFT;
    case 'right':
      return Button.RIGHT;
    case 'middle':
      return Button.MIDDLE;
    default:
      return Button.LEFT;
  }
}
