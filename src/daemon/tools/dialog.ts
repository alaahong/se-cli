import { Response } from '../../response';

/**
 * Wait for a dialog (alert/confirm/prompt) to appear, with a timeout.
 * Handles the race condition where the dialog is triggered via setTimeout
 * in eval but hasn't appeared yet when dialog-accept/dismiss is called.
 */
async function waitForAlert(driver: any, timeout = 5000): Promise<any> {
  const { until } = require('selenium-webdriver');
  try {
    await driver.wait(until.alertIsPresent(), timeout);
  } catch {
    // If wait times out, fall through to switchTo().alert() which will
    // throw a descriptive "no such alert" error.
  }
  return driver.switchTo().alert();
}

/**
 * dialog-accept [text] — accept alert/confirm/prompt dialog
 * If text is provided, it is typed into a prompt dialog before accepting.
 */
export async function browser_dialog_accept(
  driver: any,
  params: { text?: string },
  response: Response,
): Promise<void> {
  const alert = await waitForAlert(driver);

  if (params.text) {
    await alert.sendKeys(params.text);
    response.addCode(`await driver.switchTo().alert().sendKeys(${JSON.stringify(params.text)});`);
  }

  await alert.accept();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode('await driver.switchTo().alert().accept();');
  response.addResult('dialog accepted');
}

/**
 * dialog-dismiss — dismiss alert/confirm/prompt dialog
 */
export async function browser_dialog_dismiss(
  driver: any,
  params: {},
  response: Response,
): Promise<void> {
  const alert = await waitForAlert(driver);
  await alert.dismiss();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode('await driver.switchTo().alert().dismiss();');
  response.addResult('dialog dismissed');
}
