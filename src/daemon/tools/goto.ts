import { Response } from '../../response';

export async function browser_goto(driver: any, params: { url: string }, response: Response): Promise<void> {
  await driver.get(params.url);
  // Wait for the document to be fully loaded (interactive or complete).
  // This prevents race conditions where snapshot/find runs before the
  // page's DOM is available.
  try {
    await driver.wait(
      async () => {
        const readyState = await driver.executeScript('return document.readyState');
        return readyState === 'complete' || readyState === 'interactive';
      },
      10000,
      'Page did not reach ready state',
    );
  } catch {
    // Don't fail the navigation if the wait times out — the page may
    // still be usable. The caller can retry snapshot/find if needed.
  }
  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode(`await driver.get('${params.url}');`);
  response.addResult(`navigated to ${params.url}`);
}
