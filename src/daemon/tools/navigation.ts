import { Response } from '../../response';

export async function browser_go_back(driver: any, _params: any, response: Response): Promise<void> {
  await driver.navigate().back();
  response.addCode(`await driver.navigate().back();`);
  response.addResult('navigated back');
}

export async function browser_go_forward(driver: any, _params: any, response: Response): Promise<void> {
  await driver.navigate().forward();
  response.addCode(`await driver.navigate().forward();`);
  response.addResult('navigated forward');
}

export async function browser_reload(driver: any, _params: any, response: Response): Promise<void> {
  await driver.navigate().refresh();
  response.addCode(`await driver.navigate().refresh();`);
  response.addResult('reloaded');
}
