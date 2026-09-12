// ==========================================
// call-staff-barcode-onetime-fix.js
// ------------------------------------------
// 【今回の修正】
// 「🔔 店員を呼ぶ」を押すと登録される自動化バーコード（CALLで始まる
// バーコード／sendTouchPanelCallRequest）が、これまで oneTime: false の
// まま登録されていたため、レジでバーコードを読み取って呼び出し対応が
// 完了した後も自動化バーコード一覧に残り続け、古い呼び出しバーコードを
// 誤って何度も読み取れてしまう状態になっていた。
// 「送信」時の注文バーコードは既に oneTime: true（使い切り）になって
// いるのと同じ扱いに揃える。
//
// ※「💰 お会計希望」側（BILLバーコード）は今回のご依頼の対象外
//   （「店員を呼ぶ」時にできるバーコードのみ、との指示のため）。
//
// index.html / touch-panel-order-system.js は直接編集せず、
// registerAutomationBarcodeViaForm() をラップするフック方式で実現する。
// generateTouchPanelBarcode('CALL') が採番する「CALL」で始まる
// バーコードのときだけ oneTime を強制的に true にする。
// ==========================================
(function hookRegisterAutomationBarcodeForCallOneTime() {
    function tryHook() {
        if (typeof window.registerAutomationBarcodeViaForm !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.registerAutomationBarcodeViaForm;
        window.registerAutomationBarcodeViaForm = function (payload) {
            if (payload && typeof payload.barcode === 'string' && payload.barcode.indexOf('CALL') === 0 && !payload.oneTime) {
                payload = Object.assign({}, payload, { oneTime: true });
            }
            return original.call(this, payload);
        };
    }
    tryHook();
})();
