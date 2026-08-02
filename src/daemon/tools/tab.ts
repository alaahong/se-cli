import { Response } from '../../response';

export async function browser_tab_list(driver: any, _params: any, response: Response): Promise<void> {
  const originalHandle = await driver.getWindowHandle();
  const handles = await driver.getAllWindowHandles();

  const tabs: { handle: string; title: string; url: string }[] = [];
  for (const handle of handles) {
    await driver.switchTo().window(handle);
    const title = await driver.getTitle();
    const url = await driver.getCurrentUrl();
    tabs.push({ handle, title, url });
  }

  // Switch back to the original handle so the caller's context is preserved.
  await driver.switchTo().window(originalHandle);

  response.addCode(`const handles = await driver.getAllWindowHandles();`);
  response.addResult(JSON.stringify(tabs, null, 2));
}

export async function browser_tab_new(
  driver: any,
  params: { url?: string },
  response: Response
): Promise<void> {
  await driver.switchTo().newWindow('tab');
  if (params.url) {
    await driver.get(params.url);
    response.addCode(`await driver.switchTo().newWindow('tab');\nawait driver.get('${params.url}');`);
    response.addResult(`opened new tab: ${params.url}`);
  } else {
    response.addCode(`await driver.switchTo().newWindow('tab');`);
    response.addResult('opened new tab');
  }
}

export async function browser_tab_close(driver: any, _params: any, response: Response): Promise<void> {
  await driver.close();

  const handles = await driver.getAllWindowHandles();
  if (handles.length === 0) {
    response.addCode(`await driver.close();`);
    response.addResult('closed tab; no remaining tabs');
    return;
  }

  // Switch to the first remaining handle so the driver has a valid window.
  await driver.switchTo().window(handles[0]);
  response.addCode(`await driver.close();\nawait driver.switchTo().window(handles[0]);`);
  response.addResult('closed tab');
}

export async function browser_tab_select(
  driver: any,
  params: { index: number },
  response: Response
): Promise<void> {
  const handles = await driver.getAllWindowHandles();
  const index = params.index;

  if (!Number.isInteger(index) || index < 0 || index >= handles.length) {
    response.addError(`tab index ${index} out of range (0..${handles.length - 1})`);
    return;
  }

  await driver.switchTo().window(handles[index]);
  response.addCode(`const handles = await driver.getAllWindowHandles();\nawait driver.switchTo().window(handles[${index}]);`);
  response.addResult(`switched to tab ${index}`);
}
