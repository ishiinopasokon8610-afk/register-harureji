// ==========================================
// call-number-receipt-print.js
// 「呼び出し番号を出す」（order-system-settings.js の✅）がONの場合、
// 直近の会計で発行された呼び出し番号を、レシートの一番下に大きく印字する
// ------------------------------------------
// call-number-system.js は、会計成立のたびに pos_history[0].callNumber
// として番号を記録している。generateReceiptHTML() は必ずその直後
// （領収書発行の確認 → 印刷モーダル表示）の流れでのみ呼ばれるため、
// このタイミングで pos_history[0] を読めば、今回の会計の呼び出し番号を
// 取得できる。
//
// register.js / call-number-system.js は直接編集せず、
// generateReceiptHTML() をフックして実行後にDOM側（#print-receipt-content）
// へ追記する（receipt-hide-name-system.js と同じ「フック方式」）。
// ==========================================

(function hookCallNumberIntoReceipt() {
    function tryHook() {
        if (typeof window.generateReceiptHTML !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateReceiptHTML;
        window.generateReceiptHTML = function (...args) {
            const result = original.apply(this, args);
            appendCallNumberToReceipt();
            return result;
        };
    }
    tryHook();
})();

function appendCallNumberToReceipt() {
    if (typeof isShowCallNumberEnabled !== 'function' || !isShowCallNumberEnabled()) return;

    const content = document.getElementById('print-receipt-content');
    if (!content) return;

    // 直近の会計成立時に call-number-system.js が pos_history[0] に記録した番号を読む
    let callNumber = null;
    try {
        const historyList = JSON.parse(localStorage.getItem('pos_history') || '[]');
        if (historyList.length > 0 && historyList[0].callNumber) {
            callNumber = historyList[0].callNumber;
        }
    } catch (e) {}

    if (!callNumber) return; // 番号がまだ採番されていない場合は何も表示しない

    // 同じ会計で領収書つき・領収書なしなど複数回レシートを出し直した場合の重複防止
    const old = document.getElementById('receipt-call-number-block');
    if (old) old.remove();

    const formatted = (typeof formatCallNumber === 'function')
        ? formatCallNumber(callNumber)
        : String(callNumber).padStart(3, '0');

    const block = document.createElement('div');
    block.id = 'receipt-call-number-block';
    block.style.cssText = 'text-align:center; margin-top:18px; padding-top:12px; border-top:2px dashed #333;';
    block.innerHTML = `
        <div style="font-size:12px; letter-spacing:0.1em; color:#555;">よびだしばんごう</div>
        <div style="font-size:40px; font-weight:900; font-family:monospace; line-height:1.2;">${formatted}</div>
    `;
    content.appendChild(block);
}
