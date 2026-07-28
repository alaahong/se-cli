export function generateAriaSnapshotScript(): string {
  return `
(function() {
  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea',
    'summary', 'details', 'option', 'optgroup'
  ]);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'tab', 'combobox',
    'option', 'searchbox', 'spinbutton', 'slider', 'switch'
  ]);

  const TAG_TO_ROLE = {
    'a': 'link',
    'button': 'button',
    'input': 'textbox',
    'select': 'combobox',
    'textarea': 'textbox',
    'nav': 'navigation',
    'main': 'main',
    'header': 'banner',
    'footer': 'contentinfo',
    'aside': 'complementary',
    'form': 'form',
    'search': 'search',
    'h1': 'heading', 'h2': 'heading', 'h3': 'heading',
    'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
    'img': 'image',
    'ul': 'list', 'ol': 'list',
    'li': 'listitem',
    'table': 'table',
    'tr': 'row',
    'details': 'group',
    'summary': 'button',
    'dialog': 'dialog',
    'alert': 'alert',
    'menu': 'menu',
    'menubar': 'menubar',
    'toolbar': 'toolbar',
    'tablist': 'tablist',
    'tab': 'tab',
    'tabpanel': 'tabpanel',
    'option': 'option',
  };

  let refCounter = 0;
  const lines = [];

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag in TAG_TO_ROLE) return TAG_TO_ROLE[tag];
    return null;
  }

  function getLabel(el, role) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const labelEl = document.getElementById(labelledby);
      if (labelEl) return labelEl.textContent.trim();
    }

    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.id) {
          const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (label) return label.textContent.trim();
        }
        const parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();
      }
      return el.placeholder || el.name || '';
    }

    if (tag === 'img') return el.alt || el.title || '';

    const text = (el.textContent || '').trim();
    return text ? text.slice(0, 80) : '';
  }

  function isInteractive(el, role) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    return false;
  }

  function isHidden(el) {
    if (el.hidden) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return true;
    // getComputedStyle for elements that may be hidden via CSS classes
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch (e) {}
    return false;
  }

  function getAttrs(el, role) {
    const attrs = [];
    const tag = el.tagName.toLowerCase();
    if (tag.match(/^h[1-6]$/)) {
      attrs.push('level=' + tag[1]);
    }
    if (role === 'heading' && el.getAttribute('aria-level')) {
      attrs.push('level=' + el.getAttribute('aria-level'));
    }
    if (el.tagName === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' && el.checked) attrs.push('checked');
      if (type === 'radio' && el.checked) attrs.push('checked');
      if (el.disabled) attrs.push('disabled');
    }
    return attrs.length ? ' [' + attrs.join(' ') + ']' : '';
  }

  function walk(el, level, depth) {
    if (level > depth) return;
    if (isHidden(el)) return;

    const role = getRole(el);
    if (role === 'none' || role === 'presentation') {
      for (const child of el.children) walk(child, level, depth);
      return;
    }

    const label = getLabel(el, role);
    const interactive = isInteractive(el, role);

    let refAttr = '';
    if (interactive) {
      const ref = 'e' + (++refCounter);
      el.setAttribute('data-se-ref', ref);
      refAttr = ' [ref=' + ref + ']';
    }

    const attrs = getAttrs(el, role);
    const indent = '  '.repeat(level);

    if (role) {
      const labelPart = label ? ' "' + label + '"' : '';
      lines.push(indent + '- ' + role + labelPart + attrs + refAttr);
    }

    // Detect iframes and output placeholder
    for (const child of el.children) {
      if (child.tagName === 'IFRAME') {
        const src = child.src || child.getAttribute('src') || '';
        const indent2 = '  '.repeat(level + 1);
        lines.push(indent2 + '- iframe: ' + src);
        continue;
      }
      walk(child, level + 1, depth);
    }
    // Detect open shadow roots
    if (el.shadowRoot) {
      const indent2 = '  '.repeat(level + 1);
      lines.push(indent2 + '- shadowroot:');
      for (const child of el.shadowRoot.children) {
        walk(child, level + 2, depth);
      }
    }
  }

  return function generateAriaSnapshot(options) {
    options = options || {};
    const depth = options.depth || 50;
    refCounter = 0;
    lines.length = 0;

    const root = options.target
      ? document.querySelector('[data-se-ref="' + options.target + '"]') || document.querySelector(options.target)
      : document.body;

    if (!root) return '';

    if (root === document.body) {
      lines.push('- document:');
      for (const child of root.children) walk(child, 1, depth);
    } else {
      walk(root, 0, depth);
    }

    return lines.join('\\n');
  };
})()
`;
}
