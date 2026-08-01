// se-cli i18n engine — bilingual (en/zh), default English
// Usage: add data-i18n="key" to elements, include this script after nav.js
// Dictionaries are lazy-loaded per language: i18n-en.js / i18n-zh.js
// populate window.SE_I18N_DICTS when fetched on demand.
(function () {
  'use strict';

  var STORAGE_KEY = 'se-cli-lang';
  var DEFAULT_LANG = 'en';
  var SUPPORTED = ['en', 'zh'];

  // ── Auto-translation map for common elements (nav/footer) ──
  // These are applied by matching text content, no data-i18n needed
  var AUTO_MAP = {
    'Docs': { zh: '文档', key: 'nav.docs' },
    'Roadmap': { zh: '路线图', key: 'nav.roadmap' },
    'Test Pages': { zh: '测试页', key: 'nav.testPages' },
    'GitHub': { zh: 'GitHub', key: 'nav.github' },
    'Toggle menu': { zh: '切换菜单', key: 'nav.toggleMenu' },
    'Issues': { zh: 'Issues', key: 'footer.issues' },
    'npm': { zh: 'npm', key: 'footer.npm' },
    'Ecosystem': { zh: '生态系统', key: 'footer.ecosystem' },
    'VS Code Ext': { zh: 'VS Code 扩展', key: 'footer.vscodeExt' },
    'Apache-2.0 · Built with inspiration from playwright-cli': { zh: 'Apache-2.0 · 灵感来自 playwright-cli', key: 'footer.copy' },
    'Apache-2.0 · se-cli': { zh: 'Apache-2.0 · se-cli', key: 'footer.copyShort' },
    'Home': { zh: '首页', key: 'bc.home' },
    'Get Started': { zh: '快速开始', key: 'home.getStarted' },
    'Documentation': { zh: '文档', key: 'docs.title' },
    'Ecosystem': { zh: '生态系统', key: 'footer.ecosystem' },
    'Roadmap': { zh: '路线图', key: 'rm.title' },
    'Test Pages': { zh: '测试页', key: 'tp.title' },
    'Copy': { zh: '复制', key: 'btn.copy' }
  };

  // ── Lazy dict loader ────────────────────────────────────────
  // Resolve the directory of this script so i18n-<lang>.js loads
  // correctly from root pages (assets/js/), subpages (../assets/js/),
  // and the 404 page (/se-cli/assets/js/).
  function getBaseDir() {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (/i18n\.js$/.test(src)) {
        var idx = src.lastIndexOf('/');
        return idx > -1 ? src.slice(0, idx + 1) : '';
      }
    }
    return 'assets/js/';
  }

  function ensureDict(lang, done) {
    var dicts = window.SE_I18N_DICTS;
    if (dicts && dicts[lang]) { done(); return; }
    var s = document.createElement('script');
    s.src = getBaseDir() + 'i18n-' + lang + '.js';
    s.onload = function () { done(); };
    s.onerror = function () { done(); };
    document.head.appendChild(s);
  }

  // ── Engine ──────────────────────────────────────────────────
  var current = DEFAULT_LANG;

  // Snapshot the original English text of auto-translated elements
  // (nav/footer/breadcrumb) on first load, so toggling back to English
  // restores the exact original wording (handles duplicate translations
  // like 'Docs' vs 'Documentation' both mapping to 文档).
  var ORIG_TEXT = [];

  function snapshotOriginals() {
    var selectors = [
      '.nav-links a', '.nav-links a span',
      '.nav-toggle',
      '.footer-links a',
      '.footer-copy',
      '.breadcrumb a', '.breadcrumb-current',
      '.copy-btn[aria-label]',
      '.docs-sidebar h4'
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (el.hasAttribute('data-i18n')) return;
        ORIG_TEXT.push({ el: el, text: (el.textContent || '').trim() });
      });
    });
  }

  function getLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) > -1) return saved;
    } catch (e) { /* SSR or disabled */ }
    return DEFAULT_LANG;
  }

  function setLang(lang) {
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* noop */ }
    updateToggle();
    document.documentElement.lang = lang;
    ensureDict(lang, applyTranslations);
  }

  function applyTranslations() {
    var dicts = window.SE_I18N_DICTS;
    var dict = dicts ? (dicts[current] || dicts[DEFAULT_LANG]) : null;
    if (!dict) return;

    // 1. Apply data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = dict[key];
      if (!val) return;
      if (el.hasAttribute('data-i18n-html')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    });

    // 2. Auto-translate nav links, footer links, breadcrumb, copy buttons
    var selectors = [
      '.nav-links a', '.nav-links a span',
      '.nav-toggle',
      '.footer-links a',
      '.footer-copy',
      '.breadcrumb a', '.breadcrumb-current',
      '.copy-btn[aria-label]',
      '.docs-sidebar h4'
    ];

    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        // Skip if has data-i18n (already handled)
        if (el.hasAttribute('data-i18n')) return;
        var text = (el.textContent || '').trim();
        if (AUTO_MAP[text] && current === 'zh') {
          if (el.tagName === 'BUTTON' || el.tagName === 'A') {
            // For links/buttons with child elements, only update text nodes
            var hasChildren = el.querySelector('span, svg');
            if (hasChildren && el.tagName === 'A') {
              // nav-gh link has <svg> + <span>
              var span = el.querySelector('span');
              if (span) span.textContent = AUTO_MAP[text].zh;
            } else {
              el.textContent = AUTO_MAP[text].zh;
            }
          } else {
            el.textContent = AUTO_MAP[text].zh;
          }
        } else if (current === 'en') {
          // Restore English from the initial snapshot
          var orig = null;
          for (var o = 0; o < ORIG_TEXT.length; o++) {
            if (ORIG_TEXT[o].el === el) { orig = ORIG_TEXT[o].text; break; }
          }
          if (orig !== null && orig !== text) {
            if (el.tagName === 'A' || el.tagName === 'BUTTON') {
              var span = el.querySelector('span');
              if (span) span.textContent = orig;
              else el.textContent = orig;
            } else {
              el.textContent = orig;
            }
          }
        }
      });
    });

    // 3. Auto-translate aria-labels on copy buttons
    document.querySelectorAll('.copy-btn[aria-label]').forEach(function (btn) {
      if (current === 'zh') {
        var orig = btn.getAttribute('aria-label');
        if (orig === 'Copy') btn.setAttribute('aria-label', '复制');
        else if (orig === 'Copy install command') btn.setAttribute('aria-label', '复制安装命令');
        else if (orig === 'Copy path') btn.setAttribute('aria-label', '复制路径');
      } else {
        var zh = btn.getAttribute('aria-label');
        if (zh === '复制') btn.setAttribute('aria-label', 'Copy');
        else if (zh === '复制安装命令') btn.setAttribute('aria-label', 'Copy install command');
        else if (zh === '复制路径') btn.setAttribute('aria-label', 'Copy path');
      }
    });
  }

  function updateToggle() {
    var btn = document.getElementById('lang-toggle');
    if (!btn) return;
    btn.textContent = current === 'en' ? '中文' : 'EN';
    btn.setAttribute('aria-label', current === 'en' ? '切换到中文' : 'Switch to English');
  }

  function createToggle() {
    // Check if already created
    if (document.getElementById('lang-toggle')) return;

    var navLinks = document.getElementById('nav-links');
    if (!navLinks) return;

    var btn = document.createElement('button');
    btn.id = 'lang-toggle';
    btn.className = 'lang-toggle';
    btn.type = 'button';
    btn.textContent = current === 'en' ? '中文' : 'EN';
    btn.setAttribute('aria-label', current === 'en' ? '切换到中文' : 'Switch to English');
    btn.addEventListener('click', function () {
      setLang(current === 'en' ? 'zh' : 'en');
    });

    // Insert before GitHub link if present, else append
    var ghLink = navLinks.querySelector('.nav-gh');
    if (ghLink) {
      navLinks.insertBefore(btn, ghLink);
    } else {
      navLinks.appendChild(btn);
    }
  }

  function init() {
    current = getLang();
    document.documentElement.lang = current;
    createToggle();
    snapshotOriginals();
    ensureDict(current, applyTranslations);
  }

  // Run on DOMContentLoaded (or immediately if already loaded)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
