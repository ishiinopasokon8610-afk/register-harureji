// ==========================================
// customer-thanks-fix.js
// 「ご来店ありがとうございます」表示の下に商品明細が透けて見える不具合の修正
// ------------------------------------------
// 【問題】
// 会計確定（closeCheckout）の時点では cart（購入商品データ）はまだクリアされない
// （実際にクリアされるのはレシート印刷モーダルを閉じた後）。
// そのため、客用画面の見出しが「ご来店ありがとうございます」に変わった後も
// #customer-cart-list には直前の購入商品がそのまま表示され続け、
// 画面下部に固定表示される金額バー（.customer-total-area）の背景が
// 半透明だったため、その商品名がうっすら透けて見えてしまっていた。
//
// 【対応】
// register.js は直接編集せず、updateCustomerDisplay() を安全にラップして、
// 見出しが「ご来店ありがとうございます」（＝お会計完了後、まだ次のお会計が
// 始まっていない状態）の時だけ、商品明細欄を空にする。
// cart自体の中身は変更しないので、レシート発行などの動作には影響しない。
// ==========================================

(function hookCustomerDisplayThanksFix() {
    function tryHook() {
        if (typeof updateCustomerDisplay !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const originalUpdateCustomerDisplay = updateCustomerDisplay;
        window.updateCustomerDisplay = function (...args) {
            const result = originalUpdateCustomerDisplay.apply(this, args);

            const headerMsgEl = document.getElementById('customer-header-msg');
            const listEl = document.getElementById('customer-cart-list');
            if (headerMsgEl && listEl && headerMsgEl.innerText === 'ご来店ありがとうございます') {
                listEl.innerHTML = '';
            }

            return result;
        };
    }
    tryHook();
})();
