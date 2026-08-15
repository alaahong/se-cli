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
    response.addCode(`const pdf = await driver.getBidi().then(b => b.send({ method: 'browsingContext.print', params: { context: await driver.getWindowHandle() } })); fs.writeFileSync('${params.filename ?? 'page.pdf'}', Buffer.from(pdf.result.data, 'base64'));`);
  } else {
    data = await driver.printPage();
    response.addCode(`const pdf = await driver.printPage(); fs.writeFileSync('${params.filename ?? 'page.pdf'}', Buffer.from(pdf, 'base64'));`);
  }

  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `page-${Date.now()}.pdf`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));

  response.addResult(`[PDF](.se-cli/${filename})`);
}
