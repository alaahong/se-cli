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

export async function browser_press(driver: any, params: { key: string }, response: Response): Promise<void> {
  const key = KEY_MAP[params.key] || params.key;
  await driver.switchTo().activeElement().sendKeys(key);
  const codeKey = params.key in KEY_MAP ? `Key.${params.key.toUpperCase()}` : `'${params.key}'`;
  response.addCode(`await driver.switchTo().activeElement().sendKeys(${codeKey});`);
  response.addResult(`pressed ${params.key}`);
}
