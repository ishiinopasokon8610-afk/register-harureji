// ==========================================
// ハイテク音声レジスター - レジ画面 情報バー
// カート内容が変わるたびに、以下を表示する:
//   🔢 スキャン数（カート内商品の合計点数）
//   💴 課税対象（消費税の対象になっている金額の合計）
//   🚫 免税適用中バッジ（この会計が免税になっている場合のみ表示）
// register.js は直接編集せず、updateReceipt() を安全にラップして実現する。
// ==========================================

function renderRegisterInfoBar() {
    const scanCountEl = document.getElementById('reg-scan-count');
    const taxableEl = document.getElementById('reg-taxable-amount');
    const exemptBadge = document.getElementById('reg-tax-exempt-badge');
    if (!scanCountEl || !taxableEl || !exemptBadge) return;
    if (typeof cart === 'undefined') return;

    // スキャン数：カート内の商品の合計点数（値引き行などマイナス金額の行は数えない）
    let scanCount = 0;
    // 消費税の対象になっている金額（taxRateが0より大きい行の小計）
    let taxableAmount = 0;

    cart.forEach(item => {
        const lineTotal = (item.price || 0) * (item.qty || 1);
        if ((item.price || 0) >= 0) {
            scanCount += (item.qty || 1);
        }
        if ((item.taxRate || 0) > 0) {
            taxableAmount += lineTotal;
        }
    });

    scanCountEl.innerText = scanCount.toLocaleString();
    taxableEl.innerText = `¥${taxableAmount.toLocaleString()}`;

    const isExempt = (typeof taxExemptTransaction !== 'undefined' && taxExemptTransaction);
    exemptBadge.style.display = isExempt ? 'inline-block' : 'none';
}

// register.js / state.js の読み込み後に updateReceipt をラップして、
// カート更新のたびに情報バーも一緒に更新されるようにする
(function hookRegisterInfoBarIntoUpdateReceipt() {
    function tryHook() {
        if (typeof updateReceipt !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalUpdateReceipt = updateReceipt;
        window.updateReceipt = function (...args) {
            const result = originalUpdateReceipt.apply(this, args);
            renderRegisterInfoBar();
            return result;
        };
        // 初期表示
        renderRegisterInfoBar();
    }
    tryHook();
})();
