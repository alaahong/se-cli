import { By } from 'selenium-webdriver';

export function safeFilename(filename: string): string {
  // Reject any path separator (both POSIX and Windows) so behavior is
  // platform-independent. `path.basename` alone treats `\` as a regular
  // character on Linux, which would let Windows-style traversal slip through.
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Invalid filename: path separators are not allowed. Got: ${filename}`);
  }
  return filename;
}

export async function resolveTarget(target: string) {
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return By.css(`[data-se-ref="${target}"]`);
  }
  return By.css(target);
}

export async function findElement(driver: any, target: string) {
  const by = await resolveTarget(target);
  return driver.findElement(by);
}

export function byToString(target: string): string {
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return `By.css('[data-se-ref="${target}"]')`;
  }
  return `By.css('${target}')`;
}
