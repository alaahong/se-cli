import { Response } from '../../response';
import { findElement, byToString } from './shared';

export async function browser_select(
  driver: any,
  params: { target: string; value: string },
  response: Response
): Promise<void> {
  const el = await findElement(driver, params.target);
  const { Select } = require('selenium-webdriver');
  const select = new Select(el);
  await select.selectByVisibleText(params.value);
  response.addCode(`const select = new Select(driver.findElement(${byToString(params.target)})); await select.selectByVisibleText('${params.value}');`);
  response.addResult(`selected ${params.value}`);
}
