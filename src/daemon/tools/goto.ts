import { Response } from '../../response';
import { jsString } from './shared';

export async function browser_goto(driver: any, params: { url: string }, response: Response): Promise<void> {
  await driver.get(params.url);

  // Wait for the document to be fully loaded AND for the body to have
  // at least one child element. readyState 'interactive' can fire before
  // the body is populated, causing empty snapshots in find/snapshot commands.
  try {
    await driver.wait(
      async () => {
        const state = await driver.executeScript(
          'return document.readyState === "complete" && document.body && document.body.children.length > 0;'
        );
        return state === true;
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
  response.addCode(`await driver.get(${jsString(params.url)});`);
  response.addResult(`navigated to ${params.url}`);
}
