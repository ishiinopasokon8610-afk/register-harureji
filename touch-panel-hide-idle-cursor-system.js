// ==========================================
// touch-panel-hide-idle-cursor-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」（CSSの切り替え＋
// イベント監視のみ）で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回追加したいこと】
// タッチパネル（#touch-panel-overlay）が開いている間、マウスカーソルを
// 5秒間動かさなかったら、カーソルを非表示にする。
// マウス自体はタッチ操作の端末では通常映らないが、PC・タブレットで
// マウス/タッチパッド接続時に運用しているケースや、開発・確認時に
// カーソルが画面に映り込んで邪魔・見栄えが悪い、という場合向け。
//
// 【挙動】
// ・#touch-panel-overlay が表示されている間だけ有効。
// ・マウスを動かす／クリックする／タッチする、いずれかがあれば
// 　カーソルはすぐに再表示され、タイマーも5秒に仕切り直される。
// ・5秒間何も操作が無ければ、cursor:none を当てて非表示にする。
// ・実際の商品タップ・スクロール等の操作を邪魔しないよう、あくまで
// 　CSSのcursorプロパティを切り替えるだけで、クリックやタップの
// 　判定そのものには一切影響しない。
//
// 【前提にしていること】
// #touch-panel-overlay がタッチパネル表示中は常にDOM上に存在して
// いること（他のファイルと同じ前提）。
//
// 【導入方法】
// index.html内で、touch-panel-order-system.js より後ろであれば
// どこでも構わない。
// ==========================================

(function () {
    'use strict';

    const TP_IDLE_HIDE_MS = 5000;
    const TP_IDLE_HIDE_CLASS = 'tp-idle-cursor-hidden';

    /* =========================================================
       非表示用CSS（#touch-panel-overlay配下の要素すべてに効かせる）
       ========================================================= */
    (function injectIdleCursorStyle() {
        if (document.getElementById('tp-idle-cursor-style')) return;
        const style = document.createElement('style');
        style.id = 'tp-idle-cursor-style';
        style.textContent = `
            #touch-panel-overlay.${TP_IDLE_HIDE_CLASS},
            #touch-panel-overlay.${TP_IDLE_HIDE_CLASS} * {
                cursor: none !important;
            }
        `;
        document.head.appendChild(style);
    })();

    let idleTimer = null;

    function hideCursorNow() {
        const overlay = document.getElementById('touch-panel-overlay');
        if (overlay) overlay.classList.add(TP_IDLE_HIDE_CLASS);
    }

    function showCursorAndResetTimer() {
        const overlay = document.getElementById('touch-panel-overlay');
        if (!overlay) return;
        overlay.classList.remove(TP_IDLE_HIDE_CLASS);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(hideCursorNow, TP_IDLE_HIDE_MS);
    }

    // マウス操作・タッチ操作のいずれでもタイマーをリセットする。
    // capture:trueにして、タッチパネル内のどの要素で発生したイベントも
    // 確実に拾えるようにしている。
    ['mousemove', 'mousedown', 'wheel', 'touchstart', 'touchmove', 'keydown']
        .forEach(evt => document.addEventListener(evt, showCursorAndResetTimer, { capture: true, passive: true }));

    /* =========================================================
       タッチパネルが開かれた時点でタイマーを開始する
       （開いた直後は当然カーソル表示のまま・5秒後から非表示判定）
       ========================================================= */
    function ensureIdleWatch(overlay) {
        if (!overlay) return;
        overlay.classList.remove(TP_IDLE_HIDE_CLASS);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(hideCursorNow, TP_IDLE_HIDE_MS);
    }

    (function hookOverlayCreationForIdleCursor() {
        function tryHook() {
            if (typeof window.getOrCreateTouchPanelOverlay !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.getOrCreateTouchPanelOverlay;
            window.getOrCreateTouchPanelOverlay = function (...args) {
                const overlay = original.apply(this, args);
                ensureIdleWatch(overlay);
                return overlay;
            };
        }
        tryHook();
    })();

    // 【追加の保険】タッチパネルを閉じた際にタイマーが残り続けて
    // 無駄に動き続けないよう、closeTouchPanel()をフックしてクリアする。
    (function hookCloseForIdleCursorCleanup() {
        function tryHook() {
            if (typeof window.closeTouchPanel !== 'function') {
                setTimeout(tryHook, 300);
                return;
            }
            const original = window.closeTouchPanel;
            window.closeTouchPanel = function (...args) {
                clearTimeout(idleTimer);
                return original.apply(this, args);
            };
        }
        tryHook();
    })();
})();
