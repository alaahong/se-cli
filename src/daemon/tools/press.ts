import { Response } from '../../response';
import { Key } from 'selenium-webdriver';

const KEY_MAP: Record<string, string> = {
  'Enter': Key.ENTER,
  'Tab': Key.TAB,
  'Escape': Key.ESCAPE,
  'Backspace': Key.BACK_SPACE,
  'ArrowDown': Key.ARROW_DOWN,
  'ArrowUp': Key.ARROW_UP,
  'ArrowLeft': Key.ARROW_LEFT,
  'ArrowRight': Key.ARROW_RIGHT,
  'Space': Key.SPACE,
};

const KEY_NAMES = Object.keys(KEY_MAP).join(', ');

export async function browser_press(driver: any, params: { key: string }, response: Response): Promise<void> {
  const mapped = KEY_MAP[params.key];
  if (!mapped) {
    // Unmapped keys would be typed as literal text (e.g. `press Delete`
    // inserts the string "Delete"), which is almost certainly a mistake.
    response.addError(`Unsupported key: ${params.key}. Supported keys: ${KEY_NAMES}`);
    return;
  }
  await driver.switchTo().activeElement().sendKeys(mapped);
  const codeKey = `Key.${params.key.toUpperCase()}`;
  response.addCode(`await driver.switchTo().activeElement().sendKeys(${codeKey});`);
  response.addResult(`pressed ${params.key}`);
}
