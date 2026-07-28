import { Response } from '../../response';
import { findElement, byToString } from './shared';
import { Key } from 'selenium-webdriver';

export async function browser_fill(
  driver: any,
  params: { target: string; value: string; submit?: boolean },
  response: Response
): Promise<void> {
  const el = await findElement(driver, params.target);
  await el.clear();
  await el.sendKeys(params.value);
  if (params.submit) {
    await el.sendKeys(Key.ENTER);
  }
  response.addCode(`await driver.findElement(${byToString(params.target)}).sendKeys('${params.value}');`);
  response.addResult('filled');
}
