import { Response } from '../../response';
import { Key } from 'selenium-webdriver';

export async function browser_type(driver: any, params: { value: string }, response: Response): Promise<void> {
  await driver.switchTo().activeElement().sendKeys(params.value);
  response.addCode(`await driver.switchTo().activeElement().sendKeys('${params.value}');`);
  response.addResult('typed');
}
