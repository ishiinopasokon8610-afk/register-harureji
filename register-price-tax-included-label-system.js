// ==========================================
// register-price-tax-included-label-system.js
// ------------------------------------------
// touch-panel-price-tax-included-label-system.js は、お客様用タッチパネル
// （#touch-panel-overlay 内の .tp-* クラス）の金額にだけ「（税込）」を
// 追加するものだった。
//
// このファイルは、それ以外の場所…
//   ・レジ画面（店員側）のレシート欄（#receipt-body 内の .receipt-item）
//   ・レジ画面の合計金額表示（.display-total）
//   ・お客様向けカート画面（.customer-cart-row .ccr-price、#customer-total）
// にも同じく「（税込）」を追加する。
// 他の追加機能ファイルと同じ「フック方式」（CSS上書き／既存関数を
// ラップして実行後にDOMを書き換える）で、register.js / index.html は
// 直接編集しない。
//
// 【前提にしていること・ご確認のお願い】
// ・register.js の実際のコードは見えていないため、.receipt-item の
// 　中身（商品名・価格がそれぞれどんなタグ／クラスになっているか）は
// 　正確にはわからない。ただし style.css で
// 　  .receipt-item { display:flex; justify-content:space-between; }
// 　となっており、これは「左：商品名／右：価格」の2つの要素を両端に
// 　配置する定番の書き方だったため、「各行の一番最後の子要素＝価格」
// 　という前提で、そこに（税込）を追記するようにした。
// 　register.js に updateReceipt() という関数があることは
// 　tax-report-system.js のコメントから確認できたので、そこをフックし、
// 　実行後にレシート欄を書き換える方式にしている。
// 　もし実際の構造が違う場合（価格が別の場所にある、行に他のボタン等が
// 　入っていて最後の子要素が価格ではない、など）は教えてください。
// ・レシート印刷プレビュー（#print-receipt-content）は、等幅フォントで
// 　金額を文字列として直接組み立てている可能性が高く、この方式では
// 　安全に追記できないため、今回は対象外にしている。ここにも表示
// 　したい場合は、印刷用レシートを組み立てている関数名を教えてください。
// ・#customer-deposit（お預かり）・#customer-change（お釣り）は、
// 　商品の税込価格そのものではなく、お客様が渡した金額／お釣りなので、
// 　あえて対象外にしている。
// ==========================================

/* =========================================================
   ① CSSの上書きだけで対応できる箇所
   （それぞれ単独の金額表示で、::after を足してもレイアウトが
   　崩れない場所）
   ========================================================= */
(function injectRegisterPriceTaxIncludedLabelStyle() {
    if (document.getElementById('register-tax-included-price-label-style')) return;
    const style = document.createElement('style');
    style.id = 'register-tax-included-price-label-style';
    style.textContent = `
        .display-total::after,
        #customer-total::after,
        .customer-cart-row .ccr-price::after {
            content: "（税込）";
            font-size: 0.5em;
            font-weight: 700;
            opacity: 0.8;
            margin-left: 4px;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
})();

/* =========================================================
   ② レジ画面のレシート欄（#receipt-body）
   .receipt-item は display:flex; justify-content:space-between; で
   「左：商品名／右：価格」の2要素を持つ前提のため、CSSの::afterで
   要素を1つ増やすと3つ目の要素になってしまい、両端揃えのレイアウトが
   崩れる。そのため、各行の最後の子要素（＝価格側と想定）に、直接
   「（税込）」のテキストを追記する方式にする。
   ========================================================= */
function appendTaxIncludedLabelToReceiptItems() {
    const body = document.getElementById('receipt-body');
    if (!body) return;
    body.querySelectorAll('.receipt-item').forEach(row => {
        const priceEl = row.lastElementChild;
        if (!priceEl || priceEl.dataset.taxLabelAdded === '1') return;
        priceEl.dataset.taxLabelAdded = '1';
        const label = document.createElement('span');
        label.className = 'register-tax-included-label';
        label.style.cssText = 'font-size:0.7em; font-weight:700; opacity:0.8; margin-left:4px; white-space:nowrap;';
        label.textContent = '（税込）';
        priceEl.appendChild(label);
    });
}

(function hookUpdateReceiptForTaxIncludedLabel() {
    function tryHook() {
        if (typeof window.updateReceipt !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.updateReceipt;
        window.updateReceipt = function (...args) {
            const result = original.apply(this, args);
            appendTaxIncludedLabelToReceiptItems();
            return result;
        };
    }
    tryHook();
})();
