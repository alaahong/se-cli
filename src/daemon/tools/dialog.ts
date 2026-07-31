import { Response } from '../../response';

/**
 * dialog-accept [text] — accept alert/confirm/prompt dialog
 * If text is provided, it is typed into a prompt dialog before accepting.
 */
export async function browser_dialog_accept(
  driver: any,
  params: { text?: string },
  response: Response,
): Promise<void> {
  const alert = await driver.switchTo().alert();

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
  const alert = await driver.switchTo().alert();
  await alert.dismiss();

  const title = await driver.getTitle();
  const url = await driver.getCurrentUrl();
  response.addPage({ url, title });
  response.addCode('await driver.switchTo().alert().dismiss();');
  response.addResult('dialog dismissed');
}
