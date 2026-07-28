import { Response } from '../../response';
import { findElement } from './shared';

export async function browser_eval(
  driver: any,
  params: { script: string; target?: string },
  response: Response
): Promise<void> {
  let result: any;
  if (params.target) {
    const el = await findElement(driver, params.target);
    result = await driver.executeScript(params.script, el);
  } else {
    result = await driver.executeScript(`return (${params.script});`);
  }
  const resultStr = typeof result === 'object' ? JSON.stringify(result) : String(result);
  response.addCode(`await driver.executeScript(\`${params.script}\`);`);
  response.addResult(resultStr);
}
