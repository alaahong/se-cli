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
  let frameCounter = 0;
  const lines = [];

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag in TAG_TO_ROLE) return TAG_TO_ROLE[tag];
    return null;
  }

  function getLabel(el, role) {
    // Use el.ownerDocument so labels are resolved within the
    // correct frame context (main document or iframe document).
    var doc = el.ownerDocument || document;
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var labelEl = doc.getElementById(labelledby);
      if (labelEl) return labelEl.textContent.trim();
    }

    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      var type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.id) {
          var label = doc.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (label) return label.textContent.trim();
        }
        var parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();
      }
      return el.placeholder || el.name || '';
    }

    if (tag === 'img') return el.alt || el.title || '';

    var text = (el.textContent || '').trim();
    return text ? text.slice(0, 80) : '';
  }

  function isInteractive(el, role) {
    var tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    return false;
  }

  function isHidden(el) {
    if (el.hidden) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return true;
    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch (e) {}
    return false;
  }

  function getAttrs(el, role) {
    var attrs = [];
    var tag = el.tagName.toLowerCase();
    if (tag.match(/^h[1-6]$/)) {
      attrs.push('level=' + tag[1]);
    }
    if (role === 'heading' && el.getAttribute('aria-level')) {
      attrs.push('level=' + el.getAttribute('aria-level'));
    }
    if (el.tagName === 'INPUT') {
      var type = (el.type || '').toLowerCase();
      if (type === 'checkbox' && el.checked) attrs.push('checked');
      if (type === 'radio' && el.checked) attrs.push('checked');
      if (el.disabled) attrs.push('disabled');
    }
    return attrs.length ? ' [' + attrs.join(' ') + ']' : '';
  }

  function walk(el, level, depth, framePrefix) {
    framePrefix = framePrefix || '';
    if (level > depth) return;
    if (isHidden(el)) return;

    var role = getRole(el);
    if (role === 'none' || role === 'presentation') {
      for (var i = 0; i < el.children.length; i++) {
        walk(el.children[i], level, depth, framePrefix);
      }
      return;
    }

    var label = getLabel(el, role);
    var interactive = isInteractive(el, role);

    var refAttr = '';
    if (interactive) {
      var ref = 'e' + (++refCounter);
      el.setAttribute('data-se-ref', ref);
      refAttr = ' [ref=' + framePrefix + ref + ']';
    }

    var attrs = getAttrs(el, role);
    var indent = '  '.repeat(level);

    if (role) {
      var labelPart = label ? ' "' + label + '"' : '';
      lines.push(indent + '- ' + role + labelPart + attrs + refAttr);
    }

    // Walk children — detect iframes and recurse into same-origin frames
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (child.tagName === 'IFRAME') {
        walkIframe(child, level, depth);
        continue;
      }
      walk(child, level + 1, depth, framePrefix);
    }

    // Traverse open shadow roots (no placeholder — just walk children)
    if (el.shadowRoot) {
      for (var j = 0; j < el.shadowRoot.children.length; j++) {
        walk(el.shadowRoot.children[j], level + 1, depth, framePrefix);
      }
    }
  }

  function walkIframe(iframeEl, level, depth) {
    var indent = '  '.repeat(level + 1);
    var src = iframeEl.src || iframeEl.getAttribute('src') || '';

    // Try to access same-origin iframe content
    var iframeDoc = null;
    try {
      iframeDoc = iframeEl.contentDocument || (iframeEl.contentWindow && iframeEl.contentWindow.document);
    } catch (e) {
      // Cross-origin — cannot access
    }

    if (iframeDoc && iframeDoc.body) {
      var fIdx = frameCounter++;
      var fPrefix = 'f' + fIdx;
      var title = iframeEl.title || iframeEl.getAttribute('title') || iframeDoc.title || '';
      lines.push(indent + '- iframe' + (title ? ' "' + title + '"' : '') + ':');

      // Save and reset refCounter for this frame
      var savedRefCounter = refCounter;
      refCounter = 0;

      for (var i = 0; i < iframeDoc.body.children.length; i++) {
        walk(iframeDoc.body.children[i], level + 2, depth, fPrefix);
      }

      // Restore refCounter for the parent frame
      refCounter = savedRefCounter;
    } else {
      // Cross-origin iframe — output placeholder
      lines.push(indent + '- iframe: ' + src + ' (cross-origin)');
    }
  }

  return function generateAriaSnapshot(options) {
    options = options || {};
    var depth = options.depth || 50;
    refCounter = 0;
    frameCounter = 0;
    lines.length = 0;

    var root = options.target
      ? document.querySelector('[data-se-ref="' + options.target + '"]') || document.querySelector(options.target)
      : document.body;

    if (!root) return '';

    if (root === document.body) {
      lines.push('- document:');
      for (var i = 0; i < root.children.length; i++) {
        walk(root.children[i], 1, depth, '');
      }
    } else {
      walk(root, 0, depth, '');
    }

    return lines.join('\\n');
  };
})()
`;
}
