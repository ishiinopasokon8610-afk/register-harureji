// ==========================================
// touch-panel-fullscreen-guard-system.js
// ------------------------------------------
// 次の画面を開いている間だけ、0.1秒ごとに全画面かどうかを確認し、全画面でなければ
//  ① すぐ全画面を要求する（ブラウザの仕様で、操作（タップ・キー）の直後でないと拒否されることがある）
//  ② 画面全体を覆う「タップで全画面に戻る」カバーを出し、全画面に戻るまで操作できないようにする
// また Esc は長押ししないと全画面が解除されないようにする（Chromeのキーボードロック）。
//
// 【対象の画面】（これ以外の画面では、何もしない＝全画面を強制しない）
//   ・URLが #touch-panel の画面（タッチパネル）
//   ・お席案内（呼び出し／受付）の画面（#seat-guide-overlay）
// 【導入】index.html の最後のほうに <script src="touch-panel-fullscreen-guard-system.js"></script>
// ==========================================
(function () {
  'use strict';
  var CHECK_MS = 100;
  var COVER_ID = 'tp-fs-guard-cover';

  function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  function panelInUse() {
    try {
      if (/^#touch-?panel/i.test(location.hash || '')) return true;
      var o = document.getElementById('seat-guide-overlay');
      if (o) {
        var r = o.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    } catch (e) {}
    return false;
  }

  function lockEscape() {
    try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(function () {}); } catch (e) {}
  }
  function requestFs() {
    lockEscape();
    try {
      if (window.haruFullscreenLock && typeof window.haruFullscreenLock.enter === 'function') window.haruFullscreenLock.enter();
    } catch (e) {}
    try {
      if (isFs()) return;
      var de = document.documentElement;
      var fn = de.requestFullscreen || de.webkitRequestFullscreen;
      if (fn) { var p = fn.call(de); if (p && p.catch) p.catch(function () {}); }
    } catch (e) {}
  }

  function showCover() {
    if (document.getElementById(COVER_ID)) return;
    var c = document.createElement('div');
    c.id = COVER_ID;
    c.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(18,32,58,.96);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-weight:900;text-align:center;cursor:pointer;-webkit-user-select:none;user-select:none';
    c.innerHTML = '<div style="font-size:56px">⛶</div><div style="font-size:28px">画面をタップしてください</div><div style="font-size:15px;font-weight:700;color:#c9d6ee">全画面に戻ります</div>';
    function go(ev) { ev.preventDefault(); requestFs(); }
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (n) { c.addEventListener(n, go, { passive: false }); });
    document.body.appendChild(c);
  }
  function hideCover() {
    var c = document.getElementById(COVER_ID);
    if (c) c.remove();
  }

  function tick() {
    if (!document.body) return;
    if (!panelInUse()) { hideCover(); return; }
    if (isFs()) { hideCover(); return; }
    requestFs();
    showCover();
  }

  // 操作の直後（ジェスチャー中）は全画面要求が通るので、対象の画面では、すべての操作で試す
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchend', 'click', 'keydown'].forEach(function (n) {
    document.addEventListener(n, function () { if (panelInUse() && !isFs()) requestFs(); }, true);
  });
  window.addEventListener('hashchange', tick);
  document.addEventListener('fullscreenchange', tick);
  document.addEventListener('webkitfullscreenchange', tick);

  setInterval(tick, CHECK_MS);
})();
