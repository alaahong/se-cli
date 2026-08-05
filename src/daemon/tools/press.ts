import { Response } from '../../response';
import { Key } from 'selenium-webdriver';

const KEY_MAP: Record<string, { value: string; constName: string }> = {
  'Enter': { value: Key.ENTER, constName: 'Key.ENTER' },
  'Tab': { value: Key.TAB, constName: 'Key.TAB' },
  'Escape': { value: Key.ESCAPE, constName: 'Key.ESCAPE' },
  'Backspace': { value: Key.BACK_SPACE, constName: 'Key.BACK_SPACE' },
  'ArrowDown': { value: Key.ARROW_DOWN, constName: 'Key.ARROW_DOWN' },
  'ArrowUp': { value: Key.ARROW_UP, constName: 'Key.ARROW_UP' },
  'ArrowLeft': { value: Key.ARROW_LEFT, constName: 'Key.ARROW_LEFT' },
  'ArrowRight': { value: Key.ARROW_RIGHT, constName: 'Key.ARROW_RIGHT' },
  'Space': { value: Key.SPACE, constName: 'Key.SPACE' },
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
  await driver.switchTo().activeElement().sendKeys(mapped.value);
  response.addCode(`await driver.switchTo().activeElement().sendKeys(${mapped.constName});`);
  response.addResult(`pressed ${params.key}`);
}
