import { describe, it, expect } from 'vitest';
import { generateAriaSnapshotScript } from '../../src/snapshot/aria-snapshot';

// ── Lightweight DOM mocks — enough surface for the injected script ──

class MockElement {
  tagName: string;
  attrs = new Map<string, string>();
  children: MockElement[] = [];
  textContent = '';
  hidden = false;
  style: Record<string, string> = {};
  checked = false;
  disabled = false;
  parent: MockElement | null = null;
  ownerDocument: MockDocument | null = null;
  shadowChildren: MockElement[] | null = null;
  iframeDoc: MockDocument | null = null;

  constructor(tagName: string, opts: {
    attrs?: Record<string, string>;
    text?: string;
    children?: MockElement[];
    style?: Record<string, string>;
    hidden?: boolean;
    checked?: boolean;
    disabled?: boolean;
  } = {}) {
    this.tagName = tagName.toUpperCase();
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) this.attrs.set(k, v);
    if (opts.text !== undefined) this.textContent = opts.text;
    if (opts.children) this.children = opts.children;
    if (opts.style) this.style = opts.style;
    if (opts.hidden) this.hidden = true;
    if (opts.checked) this.checked = true;
    if (opts.disabled) this.disabled = true;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  get id(): string { return this.attrs.get('id') ?? ''; }
  get type(): string { return this.attrs.get('type') ?? 'text'; }
  get placeholder(): string { return this.attrs.get('placeholder') ?? ''; }
  get name(): string { return this.attrs.get('name') ?? ''; }
  get alt(): string { return this.attrs.get('alt') ?? ''; }
  get title(): string { return this.attrs.get('title') ?? ''; }
  get src(): string { return this.attrs.get('src') ?? ''; }

  get contentDocument(): MockDocument | null {
    return this.iframeDoc;
  }
  get contentWindow(): { document: MockDocument } | null {
    return this.iframeDoc ? { document: this.iframeDoc } : null;
  }
  get shadowRoot(): { children: MockElement[] } | null {
    return this.shadowChildren ? { children: this.shadowChildren } : null;
  }
  getRootNode(): MockDocument | null {
    return this.ownerDocument;
  }
  matches(sel: string): boolean {
    return this.tagName.toLowerCase() === sel.replace(/[.#]/g, '');
  }
  closest(sel: string): MockElement | null {
    let p: MockElement | null = this.parent;
    while (p) {
      if (p.matches(sel)) return p;
      p = p.parent;
    }
    return null;
  }
}

class MockDocument {
  title = '';
  body: MockElement;
  all: MockElement[] = [];

  constructor(body: MockElement) {
    this.body = body;
    const visit = (el: MockElement) => {
      el.ownerDocument = this;
      this.all.push(el);
      for (const c of el.children) visit(c);
      if (el.shadowChildren) for (const c of el.shadowChildren) visit(c);
    };
    visit(body);
  }

  querySelector(sel: string): MockElement | null {
    // Supports the selectors the script emits: [data-se-ref="X"], #id,
    // label[for="X"] and plain tag selectors (for closest fallbacks).
    const ref = sel.match(/^\[data-se-ref="([^"]+)"\]$/);
    if (ref) return this.all.find(e => e.getAttribute('data-se-ref') === ref[1]) ?? null;
    const id = sel.match(/^#(.+)$/);
    if (id) return this.all.find(e => e.id === id[1]) ?? null;
    const labelFor = sel.match(/^label\[for="(.+)"\]$/);
    if (labelFor) {
      return (
        this.all.find(e => e.tagName === 'LABEL' && e.getAttribute('for') === labelFor[1]) ?? null
      );
    }
    const tag = sel.replace(/[.#]/g, '').toUpperCase();
    return this.all.find(e => e.tagName === tag) ?? null;
  }
}

function mockWindow() {
  return {
    getComputedStyle: (el: MockElement) => ({
      display: el.style.display || 'block',
      visibility: el.style.visibility || 'visible',
    }),
  };
}

function mockCSS() {
  return { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
}

function runSnapshot(
  doc: MockDocument,
  options?: { target?: string; depth?: number },
): string {
  const script = generateAriaSnapshotScript();
  const generate = new Function('document', 'window', 'CSS', `return (${script});`)(
    doc,
    mockWindow(),
    mockCSS(),
  ) as (opts?: { target?: string; depth?: number }) => string;
  return generate(options);
}

function build(body: MockElement): MockDocument {
  return new MockDocument(body);
}

// ── Behaviour tests: execute the generated script against mock DOM ──

describe('aria snapshot script (behaviour)', () => {
  it('assigns sequential refs to interactive elements', () => {
    const doc = build(
      new MockElement('body', {
        children: [
          new MockElement('button', { text: 'Save' }),
          new MockElement('a', { attrs: { href: '#x' }, text: 'Link' }),
        ],
      }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('[ref=e1]');
    expect(out).toContain('[ref=e2]');
    // The DOM is actually tagged, not just printed
    expect(doc.all[1].getAttribute('data-se-ref')).toBe('e1');
    expect(doc.all[2].getAttribute('data-se-ref')).toBe('e2');
  });

  it('reports heading role with level attribute', () => {
    const doc = build(
      new MockElement('body', { children: [new MockElement('h1', { text: 'Welcome' })] }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('heading "Welcome"');
    expect(out).toContain('[level=1]');
  });

  it('skips elements hidden via display:none / hidden / aria-hidden', () => {
    const doc = build(
      new MockElement('body', {
        children: [
          new MockElement('button', { text: 'Visible' }),
          new MockElement('button', { text: 'Gone', style: { display: 'none' } }),
          new MockElement('button', { text: 'HiddenAttr', hidden: true }),
          new MockElement('button', { attrs: { 'aria-hidden': 'true' }, text: 'AriaHidden' }),
        ],
      }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('"Visible"');
    expect(out).not.toContain('"Gone"');
    expect(out).not.toContain('"HiddenAttr"');
    expect(out).not.toContain('"AriaHidden"');
  });

  it('prefixes refs inside same-origin iframes with f<index>', () => {
    const iframeContent = new MockDocument(
      new MockElement('body', { children: [new MockElement('button', { text: 'InFrame' })] }),
    );
    const iframe = new MockElement('iframe', { attrs: { src: '/inner.html' } });
    iframe.iframeDoc = iframeContent;
    const doc = build(
      new MockElement('body', {
        children: [
          new MockElement('button', { text: 'Parent' }),
          iframe,
        ],
      }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('[ref=e1]'); // parent
    expect(out).toContain('[ref=f0e1]'); // inside frame
  });

  it('honors an explicit depth of 0 (root-level only)', () => {
    const doc = build(
      new MockElement('body', {
        children: [
          new MockElement('button', {
            text: 'Top',
            children: [new MockElement('button', { text: 'Nested' })],
          }),
        ],
      }),
    );
    const out = runSnapshot(doc, { depth: 0 });
    // walk starts at level 1 for body children; level > depth skips everything
    expect(out).not.toContain('"Top"');
    expect(out).not.toContain('"Nested"');
  });

  it('resolves input type=checkbox to the checkbox role', () => {
    const doc = build(
      new MockElement('body', {
        children: [new MockElement('input', { attrs: { type: 'checkbox' } })],
      }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('- checkbox');
  });

  it('surfaces aria-expanded / aria-checked state attributes', () => {
    const doc = build(
      new MockElement('body', {
        children: [
          new MockElement('button', { attrs: { 'aria-expanded': 'true' }, text: 'Menu' }),
          new MockElement('input', { attrs: { type: 'checkbox', 'aria-checked': 'true' } }),
        ],
      }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('[aria-expanded=true]');
    expect(out).toContain('[aria-checked=true]');
  });

  it('truncates long text labels to 80 characters', () => {
    const long = 'x'.repeat(120);
    const doc = build(
      new MockElement('body', { children: [new MockElement('button', { text: long })] }),
    );
    const out = runSnapshot(doc);
    expect(out).toContain('"'.repeat(1) + 'x'.repeat(80));
    expect(out).not.toContain('x'.repeat(81));
  });
});
