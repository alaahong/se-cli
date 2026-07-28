import { Response } from '../../response';
import { findElement, byToString } from './shared';

export async function browser_check(driver: any, params: { target: string }, response: Response): Promise<void> {
  const el = await findElement(driver, params.target);
  if (!(await el.isSelected())) await el.click();
  response.addCode(`const el = driver.findElement(${byToString(params.target)}); if (!(await el.isSelected())) await el.click();`);
  response.addResult('checked');
}

export async function browser_uncheck(driver: any, params: { target: string }, response: Response): Promise<void> {
  const el = await findElement(driver, params.target);
  if (await el.isSelected()) await el.click();
  response.addCode(`const el = driver.findElement(${byToString(params.target)}); if (await el.isSelected()) await el.click();`);
  response.addResult('unchecked');
}
