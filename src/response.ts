import type { PageMeta, SerializedResponse } from './protocol';

export interface ResponseOptions {
  raw: boolean;
  json: boolean;
}

export class Response {
  private page?: PageMeta;
  private snapshot?: string;
  private code: string[] = [];
  private results: string[] = [];
  private errors: string[] = [];

  constructor(private opts: ResponseOptions) {}

  get options(): ResponseOptions { return this.opts; }

  addPage(meta: PageMeta): void { this.page = meta; }
  addSnapshot(yaml: string): void { this.snapshot = yaml; }
  addCode(line: string): void { this.code.push(line); }
  addResult(text: string): void { this.results.push(text); }
  addError(text: string): void { this.errors.push(text); }

  serialize(): string {
    if (this.opts.json) return this.serializeJson();
    if (this.opts.raw) return this.serializeRaw();
    return this.serializeText();
  }

  private serializeText(): string {
    const sections: string[] = [];
    if (this.errors.length) {
      sections.push('### Error\n' + this.errors.join('\n'));
    }
    if (this.page) {
      sections.push(`### Page\n- Page URL: ${this.page.url}\n- Page Title: ${this.page.title}`);
    }
    if (this.snapshot) {
      sections.push('### Snapshot\n' + this.snapshot);
    }
    if (this.code.length) {
      sections.push('### Ran Selenium code\n```js\n' + this.code.join('\n') + '\n```');
    }
    if (this.results.length) {
      sections.push('### Result\n' + this.results.join('\n'));
    }
    return sections.join('\n\n');
  }

  private serializeRaw(): string {
    return this.results.join('\n');
  }

  private serializeJson(): string {
    const obj: SerializedResponse = {};
    if (this.page) obj.page = this.page;
    if (this.snapshot) obj.snapshot = this.snapshot;
    if (this.code.length) obj.code = this.code;
    if (this.results.length) obj.result = this.results.join('\n');
    if (this.errors.length) obj.error = this.errors.join('\n');
    return JSON.stringify(obj, null, 2);
  }
}
