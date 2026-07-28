import { Response } from '../../response';

export async function browser_goto(driver: any, params: { url: string }, response: Response): Promise<void> {
  await driver.get(params.url);
  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.get('${params.url}');`);
  response.addResult(`navigated to ${params.url}`);
}
