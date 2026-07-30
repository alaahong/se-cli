// 首页与 commands 页：命令 tab 切换 + token 条动画 + 同节高亮
(function () {
  'use strict';

  // === 命令 tab ===
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

  // === Token 条进入视口时动画 ===
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
})();
