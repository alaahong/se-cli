// 所有页面共享：移动端 nav 切换、滚动阴影、复制按钮、平滑滚动
(function () {
  'use strict';

  // === 移动端 nav toggle ===
  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');
  var nav = document.getElementById('nav');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
      navToggle.classList.toggle('open');
    });

    // 点击链接后关闭菜单（移动端）
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.classList.remove('open');
      });
    });
  }

  // === 滚动时给 nav 加阴影 ===
  if (nav) {
    var onScroll = function () {
      if (window.scrollY > 8) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // === 根据当前路径高亮 nav 当前页 ===
  (function highlightCurrent() {
    var path = window.location.pathname.replace(/\/+$/, '');
    var segments = path.split('/');
    var dir = segments[segments.length - 2] || '';
    navLinks && navLinks.querySelectorAll('a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('http') === 0) return;
      // 子页面链接形如 ../docs/index.html 或 ./docs/index.html
      if (href.indexOf('docs/') > -1 && dir === 'docs') a.classList.add('current');
      else if (href.indexOf('roadmap/') > -1 && dir === 'roadmap') a.classList.add('current');
      else if (href.indexOf('test-pages/') > -1 && dir === 'test-pages') a.classList.add('current');
    });
  })();

  // === 复制按钮 ===
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-copy');
      var target = targetId ? document.getElementById(targetId) : null;
      // 若未指定 id，复制按钮最近的 code-block 内容
      if (!target) {
        var block = btn.closest('.code-block') || btn.closest('.testpage-cmd');
        if (block) target = block.querySelector('code') || block.querySelector('pre');
      }
      if (!target) return;

      var text = target.innerText || target.textContent;

      var done = function () {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 1600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    });
  });

  function fallbackCopy(text, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (cb && ok) cb();
    } catch (e) { /* noop */ }
  }

  // === 同页锚点平滑滚动（带 sticky nav 偏移）===
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      var el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      var top = el.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });
})();
