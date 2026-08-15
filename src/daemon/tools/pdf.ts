import { Response } from '../../response';
import { safeFilename } from './shared';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v0.10: `pdf` — save the current page as a PDF.
 *
 * Default: W3C WebDriver print endpoint (`driver.printPage()`), which
 * returns a base64-encoded PDF and works on Chromium (Chrome/Edge) and
 * Firefox. With `--bidi`: WebDriver BiDi `browsingContext.print`
 * (v0.13). Output lands in `<cwd>/.se-cli/` like screenshots.
 */
export async function browser_pdf(
  driver: any,
  params: { filename?: string; bidi?: boolean },
  response: Response
): Promise<void> {
  let data: string;
  let b64Expr: string;
  if (params.bidi) {
    let bidi: any;
    try {
      bidi = await driver.getBidi();
    } catch (e: any) {
      throw new Error(`Error: pdf --bidi requires WebDriver BiDi — this browser/session does not support it (Safari does not): ${e.message}`);
    }
    const context = await driver.getWindowHandle();
    const payload = await bidi.send({ method: 'browsingContext.print', params: { context } });
    if (payload && payload.error) {
      throw new Error(`browsingContext.print: ${payload.error.message || JSON.stringify(payload.error)}`);
    }
    data = payload?.result?.data as string;
    b64Expr = `(await driver.getBidi().then(b => b.send({ method: 'browsingContext.print', params: { context: await driver.getWindowHandle() } }))).result.data`;
  } else {
    data = await driver.printPage();
    b64Expr = `(await driver.printPage())`;
  }

  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `page-${Date.now()}.pdf`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));

  // Replay code uses the actual resolved filename so re-running the emitted
  // snippet reproduces the exact same artifact.
  response.addCode(`const buf = Buffer.from(${b64Expr}, 'base64'); fs.writeFileSync('${filename}', buf);`);
  response.addResult(`[PDF](.se-cli/${filename})`);
}
