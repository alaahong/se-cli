import { By } from 'selenium-webdriver';
import * as path from 'path';

export function safeFilename(filename: string): string {
  const base = path.basename(filename);
  if (base !== filename) {
    throw new Error(`Invalid filename: path traversal not allowed. Got: ${filename}`);
  }
  return base;
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
