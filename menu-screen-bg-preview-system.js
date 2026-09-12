// ==========================================
// menu-screen-bg-preview-system.js
// ------------------------------------------
// 【この機能】
// これまで、設定した「タッチパネルの背景写真」は仕様上、
// メニュー画面（商品が並ぶ、明るい専用テーマの画面）には
// 一切表示されなかった（商品グリッドの視認性を優先するため）。
//
// そのため、店員が「🖼️ 背景設定」から写真を設定しても、
// 設定した直後に見ているメニュー画面では何も変化がなく、
// 「保存できていないのでは？」と誤解してしまう問題があった。
//
// 【対応】
// メニュー画面の商品グリッド部分（.tp-body）はこれまで通り
// 明るい背景のままにして視認性を維持しつつ、上部のトップバー
// （店名・テーブル名などが出ている帯）にだけ、設定した背景写真を
// 薄暗いグラデーション越しにうっすら表示するようにする。
// これにより、
//   ・メニュー画面でも「ちゃんと設定した写真が反映されている」と
//     視覚的に確認できる
//   ・商品一覧の読みやすさはそのまま
// を両立する。
//
// 人数選択・客用/店員用・テーブル選択の各画面は元の仕様のまま
// （フルスクリーンで背景写真を表示）変更しない。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// applyTouchPanelBackground() をラップするフック方式で実現する。
// ==========================================

(function injectMenuBgPreviewStyle() {
    if (document.getElementById('tp-menu-bg-preview-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-menu-bg-preview-style';
    style.textContent = `
        #touch-panel-overlay.tp-theme-menu .tp-topbar.tp-menu-bg-preview {
            background-size: cover;
            background-position: center;
            position: relative;
        }
        #touch-panel-overlay.tp-theme-menu .tp-topbar.tp-menu-bg-preview::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(to bottom, rgba(18,32,58,0.55), rgba(18,32,58,0.75));
            pointer-events: none;
        }
        #touch-panel-overlay.tp-theme-menu .tp-topbar.tp-menu-bg-preview > * {
            position: relative;
            z-index: 1;
        }
    `;
    document.head.appendChild(style);
})();

function applyMenuScreenBgPreview() {
    const overlay = document.getElementById('touch-panel-overlay');
    if (!overlay) return;
    const topbar = overlay.querySelector('.tp-topbar');
    if (!topbar) return;

    const isMenuTheme = overlay.classList.contains('tp-theme-menu');
    const url = (typeof getTouchPanelBgUrl === 'function') ? getTouchPanelBgUrl() : '';

    if (isMenuTheme && url) {
        topbar.classList.add('tp-menu-bg-preview');
        topbar.style.backgroundImage = `url('${(typeof tpCssStr === 'function' ? tpCssStr(url) : url)}')`;
    } else {
        topbar.classList.remove('tp-menu-bg-preview');
        topbar.style.backgroundImage = '';
    }
}

(function hookApplyBackgroundForMenuPreview() {
    function tryHook() {
        if (typeof window.applyTouchPanelBackground !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.applyTouchPanelBackground;
        window.applyTouchPanelBackground = function (...args) {
            const result = original.apply(this, args);
            applyMenuScreenBgPreview();
            return result;
        };
    }
    tryHook();
})();

// メニュー画面自体の再描画（renderTouchPanelMenuScreen）は
// applyTouchPanelBackground を経由しないタイミングもあるため、
// 保険としてこちらもフックしておく
(function hookMenuRenderForBgPreview() {
    function tryHook() {
        if (typeof window.renderTouchPanelMenuScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelMenuScreen;
        window.renderTouchPanelMenuScreen = function (...args) {
            const result = original.apply(this, args);
            applyMenuScreenBgPreview();
            return result;
        };
    }
    tryHook();
})();
