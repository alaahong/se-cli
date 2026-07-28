import { Response } from '../../response';

export async function browser_title(driver: any, _params: any, response: Response): Promise<void> {
  const title = await driver.getTitle();
  response.addResult(title);
}
