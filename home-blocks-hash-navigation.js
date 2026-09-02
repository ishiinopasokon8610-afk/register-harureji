// ==========================================
// home-blocks-hash-navigation.js
// home-automation-blocks.js の「自動化バーコード（＋会計ブロック）一覧」
// オーバーレイに、URLハッシュ（#auto-blocks）を付与する
// ------------------------------------------
// screen-hash-navigation.js が showScreen() 経由の画面にハッシュを
// 付けているのと同じ考え方を、showScreen() を経由しないこのオーバーレイ
// （ホーム画面の4秒長押しで開く／閉じるボタンで閉じる）にも広げる。
// ・開いたら #auto-blocks を設定
// ・閉じたら #home に戻す
// ・ブラウザの戻るボタン（hashchange）で #auto-blocks から離れたら、
//   オーバーレイも自動的に閉じる
// ・ページ再読み込み時に #auto-blocks が付いていれば、
//   ホーム画面が用意でき次第オーバーレイを開き直す
//
// home-automation-blocks.js / index.html は直接編集せず、
// openHomeAutomationBlocks() / closeHomeAutomationBlocks() をラップして
// 実現する（他の追加機能ファイルと同じ「フック方式」）。
// ==========================================

const AUTO_BLOCKS_HASH = '#auto-blocks';

(function hookOpenCloseForHash() {
    function tryHook() {
        if (typeof window.openHomeAutomationBlocks !== 'function' || typeof window.closeHomeAutomationBlocks !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const originalOpen = window.openHomeAutomationBlocks;
        window.openHomeAutomationBlocks = function (...args) {
            const result = originalOpen.apply(this, args);
            if (window.location.hash !== AUTO_BLOCKS_HASH) {
                window.location.hash = AUTO_BLOCKS_HASH;
            }
            return result;
        };

        const originalClose = window.closeHomeAutomationBlocks;
        window.closeHomeAutomationBlocks = function (...args) {
            const result = originalClose.apply(this, args);
            if (window.location.hash === AUTO_BLOCKS_HASH) {
                window.location.hash = '#home';
            }
            return result;
        };
    }
    tryHook();
})();

// ブラウザの戻る/進むボタンで #auto-blocks から離れたら、
// オーバーレイが開いたままにならないよう自動的に閉じる
window.addEventListener('hashchange', () => {
    if (window.location.hash === AUTO_BLOCKS_HASH) return;
    const overlay = document.getElementById('home-automation-blocks-overlay');
    if (overlay && overlay.style.display === 'block' && typeof closeHomeAutomationBlocks === 'function') {
        closeHomeAutomationBlocks();
    }
});

// ページ再読み込み時、#auto-blocks が付いていればオーバーレイを開き直す
window.addEventListener('load', () => {
    if (window.location.hash !== AUTO_BLOCKS_HASH) return;
    (function tryRestore() {
        if (typeof window.openHomeAutomationBlocks !== 'function' || typeof discountBarcodes === 'undefined') {
            setTimeout(tryRestore, 300);
            return;
        }
        // register.js/ui.js側の#home復元処理などと競合しないよう、少し遅らせる
        setTimeout(() => {
            openHomeAutomationBlocks();
        }, 250);
    })();
});
