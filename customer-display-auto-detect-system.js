// ==========================================
// customer-display-auto-detect-system.js
// ------------------------------------------
// 【困っていたこと】
// 「年齢確認をお願いします」画面や、お会計完了時の表示画像は、
// 「この端末を客用ディスプレイとして使う」にチェックを入れた端末にしか出なかった。
// そのため、同期でつないだ端末で「客用画面を開く」を押していても、
// その端末側でチェックを入れ忘れると、客用画面が表示されているのに何も出なかった。
//
// 【この機能】
// isCustomerDisplayDevice() をラップして、次のどちらかなら「客用ディスプレイ」とみなす。
//   ・これまで通り、設定でチェックが入っている端末
//   ・いま客用画面（customer-screen）を開いている端末
// 客用画面を閉じてホームへ戻れば、自動的に元の扱い（チェックの有無）に戻る。
// 端末ごとの設定（チェックの値）自体は書き換えないので、バックアップ・同期にも影響しない。
//
// isCustomerDisplayDevice() は他のファイルで定義されているため直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現する。
// ==========================================

function isCustomerScreenCurrentlyShown() {
    const el = document.getElementById('customer-screen');
    return !!(el && el.classList.contains('active'));
}

(function hookIsCustomerDisplayDevice() {
    function tryHook() {
        if (typeof window.isCustomerDisplayDevice !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        if (window.isCustomerDisplayDevice.__autoDetectWrapped) return;
        const original = window.isCustomerDisplayDevice;
        const wrapped = function (...args) {
            try {
                if (isCustomerScreenCurrentlyShown()) return true;
            } catch (e) { /* 無視 */ }
            return original.apply(this, args);
        };
        wrapped.__autoDetectWrapped = true;
        window.isCustomerDisplayDevice = wrapped;
    }
    tryHook();
})();
