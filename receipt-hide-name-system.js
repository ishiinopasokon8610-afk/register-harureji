// ==========================================
// receipt-hide-name-system.js
// レシートから「担当:」「会員:〇〇 様」の氏名表記を削除する
// ------------------------------------------
// register.js は直接編集せず、generateReceiptHTML() をフックして
// 実行後にDOM側から該当行を取り除く（他の追加機能ファイルと同じ方式）。
// 画面表示・PNG保存どちらの元になる #print-receipt-content にも
// 同じ内容が使われているため、ここで取り除けば両方に反映される。
// ==========================================

(function hookHideNameIntoReceipt() {
    function tryHook() {
        if (typeof window.generateReceiptHTML !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateReceiptHTML;
        window.generateReceiptHTML = function (...args) {
            const result = original.apply(this, args);
            removeNamesFromReceipt();
            return result;
        };
    }
    tryHook();
})();

function removeNamesFromReceipt() {
    const content = document.getElementById('print-receipt-content');
    if (!content) return;

    Array.from(content.children).forEach(el => {
        const text = (el.textContent || '').trim();
        // 「担当: 〇〇」の行、「会員: 〇〇 様」の行を削除する
        if (text.indexOf('担当:') === 0 || text.indexOf('会員:') === 0) {
            el.remove();
        }
    });
}
