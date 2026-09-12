// ==========================================
// home-bg-fit-contain-ensure-fix.js
// ------------------------------------------
// 【今回の修正】
// 「人数選択・客用/店員用選択・テーブル選択」など、ホーム側の待受画面の
// 背景写真が、端末の画面比率と写真の比率が合わないときに端が切れてしまう
// （はみ出た部分が見切れる）問題への対応。
//
// 原因: applyTouchPanelBackground() が背景を適用するたびに、
//   overlay.style.backgroundSize = 'cover';
// をJSで直接（インラインスタイルとして）設定している。インラインスタイルは
// CSSのスタイルシートよりも優先度が高いため、スタイルシート側だけで
// background-size: contain に変更しても、この関数が呼ばれるたびに
// 'cover' で上書きされてしまい、効果が出ない（＝見た目が変わらない）。
//
// 【対応】
// applyTouchPanelBackground() 自体をラップし、実行された「直後」に
// 同じインラインスタイルとして background-size: contain を上書きする。
// インラインスタイル同士なら「後から設定した方が勝つ」ため、確実に
// containが効くようになる。containにすると、画面比率と写真比率が
// 合わない分は隙間ができるが、そこは#touch-panel-overlay本来の背景色が
// 見えるだけなので、写真が切れて見えなくなるよりも安全な見え方になる。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// applyTouchPanelBackground() をラップするフック方式で実現する。
// ==========================================
(function hookApplyBackgroundForHomeContainFit() {
    function tryHook() {
        if (typeof window.applyTouchPanelBackground !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.applyTouchPanelBackground;
        window.applyTouchPanelBackground = function (...args) {
            const result = original.apply(this, args);
            const overlay = document.getElementById('touch-panel-overlay');
            if (overlay && overlay.style.backgroundImage) {
                overlay.style.backgroundSize = 'contain';
                overlay.style.backgroundRepeat = 'no-repeat';
                overlay.style.backgroundPosition = 'center';
            }
            return result;
        };
    }
    tryHook();
})();
