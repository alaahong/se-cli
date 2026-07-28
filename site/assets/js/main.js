(function () {
  'use strict';

  // === Mobile nav toggle ===
  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');
  var nav = document.getElementById('nav');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
      navToggle.classList.toggle('open');
    });

    // Close menu when a link is clicked (mobile)
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.classList.remove('open');
      });
    });
  }

  // === Nav shadow on scroll ===
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

  // === Command tabs ===
  var tabs = document.querySelectorAll('.cmd-tab');
  var panels = document.querySelectorAll('.cmd-panel');

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var target = tab.getAttribute('data-tab');

      tabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      panels.forEach(function (p) { p.classList.remove('active'); });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      var panel = document.querySelector('.cmd-panel[data-panel="' + target + '"]');
      if (panel) panel.classList.add('active');
    });
  });

  // === Copy buttons ===
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-copy');
      var target = document.getElementById(targetId);
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

  // === Active section highlight in nav ===
  var navItems = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = [];
  navItems.forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    var sec = document.getElementById(id);
    if (sec) sections.push({ link: a, section: sec });
  });

  if (sections.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          sections.forEach(function (s) { s.link.classList.remove('current'); });
          var match = sections.find(function (s) { return s.section === entry.target; });
          if (match) match.link.classList.add('current');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

    sections.forEach(function (s) { io.observe(s.section); });
  }

  // === Token bar animation ===
  var tokenBars = document.querySelectorAll('.token-bar-fill');
  if (tokenBars.length && 'IntersectionObserver' in window) {
    var barObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var bar = entry.target;
          var width = bar.style.width;
          bar.style.width = '0';
          setTimeout(function () { bar.style.width = width; }, 100);
          barObserver.unobserve(bar);
        }
      });
    }, { threshold: 0.3 });
    tokenBars.forEach(function (bar) { barObserver.observe(bar); });
  }

  // === Smooth scroll offset for sticky nav ===
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
