import { Response } from '../../response';

export async function browser_url(driver: any, _params: any, response: Response): Promise<void> {
  const url = await driver.getCurrentUrl();
  response.addResult(url);
}
