// ==========================================
// touch-panel-price-tax-included-label-system.js
// ------------------------------------------
// このファイルも index.html / touch-panel-order-system.js を直接編集せず、
// 「フック方式」で、CSSの上書き（::after で文字を追加）のみで実現している。
// （index.html には、このファイルを読み込む <script> タグを1行追加しただけ）
//
// 【今回の対応】
// お客様がタッチパネルで目にする金額（商品カード・おすすめバナー・
// 商品詳細ポップアップ・カート・お会計確認・注文履歴）の右側に、
// すべて「（税込）」という文字を追加する。
//
// 【重要：前提にしていること・ご確認のお願い】
// touch-panel-order-system.js / index.html を確認した限り、この
// タッチパネル注文システムには税額を計算するロジックが見当たらず、
// 表示されている金額（p.price など）は元の数値をそのまま表示している
// だけでした。また、レジ側の「税区分内訳」「課税対象」といった表示や
// 商品ごとの「税率(%)」項目の存在から、商品に登録されている価格は
// 「お客様が実際に支払う金額（税込）」として管理されている可能性が
// 高いと判断し、今回は金額の計算はそのまま変更せず、
// 「（税込）」の表示ラベルだけを追加している。
//
// もし実際には価格が税抜き（本体価格）で登録されていて、会計時に
// 別途税率を掛けて税込金額を計算している場合は、このラベルだけでは
// 不正確な表示になってしまうため、その税率がどの項目（例：商品ごとの
// 税率フィールド名）に入っているか教えてください。実際に税込金額を
// 計算して表示するよう修正します。
// ==========================================

(function injectTaxIncludedPriceLabelStyle() {
    if (document.getElementById('tp-tax-included-price-label-style')) return;
    const style = document.createElement('style');
    style.id = 'tp-tax-included-price-label-style';
    style.textContent = `
        /* 商品カード／おすすめバナー／商品詳細ポップアップ／カート／
           お会計確認／注文履歴：金額の右側に「（税込）」を追加する。
           color は指定せず currentColor のまま・opacity だけ下げるので、
           白背景でも色付き背景（注文かごバーなど）でも自然になじむ。 */
        #touch-panel-overlay .tp-menu-card-price::after,
        #touch-panel-overlay .tp-banner-card-price::after,
        #touch-panel-overlay .tp-item-modal-price::after,
        #touch-panel-overlay .tp-cart-row-price::after,
        #touch-panel-overlay .tp-cart-bar-total::after,
        #touch-panel-overlay .tp-cart-drawer-total::after,
        #touch-panel-overlay .tp-checkout-confirm-total::after,
        #touch-panel-overlay .tp-order-history-subtotal::after {
            content: "（税込）";
            font-size: 0.7em;
            font-weight: 700;
            opacity: 0.75;
            margin-left: 3px;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
})();
