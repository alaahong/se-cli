import { Response } from '../../response';

/**
 * resize <width> <height> — set viewport size via driver.manage().window().setSize()
 */
export async function browser_resize(
  driver: any,
  params: { width: number; height: number },
  response: Response,
): Promise<void> {
  await driver.manage().window().setRect({
    width: params.width,
    height: params.height,
  });

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.manage().window().setRect({ width: ${params.width}, height: ${params.height} });`);
  response.addResult(`resized to ${params.width}x${params.height}`);
}
