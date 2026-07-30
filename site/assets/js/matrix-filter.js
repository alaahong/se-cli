// matrix.html：按浏览器与版本筛选实现矩阵
(function () {
  'use strict';

  var table = document.getElementById('matrix-table');
  if (!table) return;

  var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
  // 仅数据行参与筛选（带 data-version 的行）；group-row 始终保留
  var dataRows = rows.filter(function (r) { return r.hasAttribute('data-version'); });

  var browserBtns = Array.prototype.slice.call(document.querySelectorAll('[data-matrix-browser]'));
  var versionBtns = Array.prototype.slice.call(document.querySelectorAll('[data-matrix-version]'));

  var activeBrowser = 'all';
  var activeVersion = 'all';

  // 浏览器列索引：Chrome=2 Edge=3 Firefox=4 Safari=5 Edge-IE=6（不含首列能力域）
  var browserCol = { chrome: 2, edge: 3, firefox: 4, safari: 5, 'edge-ie': 6 };

  function apply() {
    var vmin = 0, vmax = 99;
    if (activeVersion !== 'all') {
      var parts = activeVersion.split('-');
      vmin = parseFloat(parts[0]);
      vmax = parseFloat(parts[1]);
    }

    dataRows.forEach(function (row) {
      var v = parseFloat(row.getAttribute('data-version'));
      var versionOk = (activeVersion === 'all') || (v >= vmin && v <= vmax);

      var browserOk = true;
      if (activeBrowser !== 'all') {
        var col = browserCol[activeBrowser];
        var cell = row.children[col];
        if (cell) {
          // 含 matrix-cell-no 的单元格视为该浏览器不支持
          browserOk = !cell.classList.contains('matrix-cell-no');
        }
      }

      if (versionOk && browserOk) {
        row.classList.remove('hidden');
        row.classList.remove('dim');
      } else if (activeBrowser !== 'all' && browserOk && !versionOk) {
        // 版本不匹配但浏览器支持：隐藏
        row.classList.add('hidden');
      } else {
        row.classList.add('hidden');
      }
    });

    // 隐藏所有数据行都被筛掉的分组行
    rows.forEach(function (row) {
      if (row.classList.contains('group-row')) {
        var next = row.nextElementSibling;
        var hasVisible = false;
        while (next && !next.classList.contains('group-row')) {
          if (!next.classList.contains('hidden')) { hasVisible = true; break; }
          next = next.nextElementSibling;
        }
        row.classList.toggle('hidden', !hasVisible);
      }
    });
  }

  function bind(btns, attr, setter) {
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        setter(btn.getAttribute(attr));
        apply();
      });
    });
  }

  bind(browserBtns, 'data-matrix-browser', function (v) { activeBrowser = v; });
  bind(versionBtns, 'data-matrix-version', function (v) { activeVersion = v; });

  apply();
})();
