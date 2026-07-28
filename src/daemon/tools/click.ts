import { Response } from '../../response';
import { findElement, byToString } from './shared';

export async function browser_click(driver: any, params: { target: string }, response: Response): Promise<void> {
  const el = await findElement(driver, params.target);
  await el.click();
  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.findElement(${byToString(params.target)}).click();`);
  response.addResult('clicked');
}
