import { Response } from '../../response';
import { findElement } from './shared';
import { serializeValue, isWebElement } from './run-code';

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
    // Prefer expression semantics: `return (<script>);` evaluates the script
    // as an expression and returns its value. Statement-style scripts
    // (e.g. `var x = 1; x`) throw a SyntaxError under that wrapper, so we
    // fall back to executing the script verbatim (last expression is
    // returned by the WebDriver). `eval` output is code generation replay,
    // so a fallback keeps the emitted code faithful to what actually ran.
    try {
      result = await driver.executeScript(`return (${params.script});`);
    } catch {
      result = await driver.executeScript(params.script);
    }
  }

  // WebElements are registered as refs (e<N>) so the result is actionable
  // by subsequent commands — consistent with run-code semantics.
  if (isWebElement(result)) {
    result = await serializeValue(driver, result, { n: await maxExistingRef(driver) });
  } else if (typeof result === 'object' && result !== null) {
    result = JSON.stringify(result);
  } else {
    result = String(result);
  }

  response.addCode(`await driver.executeScript(\`${params.script}\`);`);
  response.addResult(result);
}

/** Find the highest existing e<N> ref so newly assigned refs don't collide. */
async function maxExistingRef(driver: any): Promise<number> {
  const max = await driver.executeScript(
    `var max = 0;
     var els = document.querySelectorAll('[data-se-ref]');
     for (var i = 0; i < els.length; i++) {
       var m = els[i].getAttribute('data-se-ref').match(/^e(\\d+)$/);
       if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
     }
     return max;`
  );
  return typeof max === 'number' && isFinite(max) ? max : 0;
}
