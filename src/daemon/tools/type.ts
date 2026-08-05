import { Response } from '../../response';
import { Key } from 'selenium-webdriver';
import { jsString } from './shared';

export async function browser_type(driver: any, params: { value: string }, response: Response): Promise<void> {
  await driver.switchTo().activeElement().sendKeys(params.value);
  response.addCode(`await driver.switchTo().activeElement().sendKeys(${jsString(params.value)});`);
  response.addResult('typed');
}
