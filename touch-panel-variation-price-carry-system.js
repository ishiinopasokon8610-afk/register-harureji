// ==========================================
// touch-panel-variation-price-carry-system.js
// ------------------------------------------
// 【不具合】
// タッチパネルでバリエーション（サイズ・トッピングなど）を選んで注文しても、
// レジで注文バーコードを読み取ると、バリエーションの差額が合計金額に
// 加算されず、常に基本価格で追加されてしまっていた。
//
// 【原因】
// タッチパネルの注文送信（submitTouchPanelOrder）は、注文内容を
// registerAutomationBarcodeViaForm() 経由で「自動化バーコード」として登録する。
// このとき商品は discount-system.js の addStagedProductRow() に渡されるが、
//   ① 保存される行は { jan, qty } だけで、バリエーション名・差額が入らない
//   ② 同じJANの行は1つに合算されるため、同じ商品の別バリエーションが混ざる
// さらにレジ側で読み取る processDiscountProducts() は、商品マスタの
// 基本価格で checkAndAddToCart() を呼ぶだけだった。
//
// 【この修正】
// ① 登録時：タッチパネルの注文内容（item.variation / item.price）から、
//    「基本価格との差額」を計算して、行に variation / priceDiff を持たせる
//    （{ jan, qty, variation, priceDiff }）。同じJANでもバリエーション・差額が
//    違えば別の行にする。バリエーションが無い商品の行は従来どおり { jan, qty }。
//    行は disc.products としてそのまま保存・Ably同期・バックアップされるため、
//    他端末にもそのまま届く。
// ② 読み取り時：行に variation があれば、レジ画面のバリエーション選択
//    （product-variant-system.js）と同じ形で、
//      名前：「商品名（バリエーション）」
//      価格：マスタの基本価格 ＋ priceDiff
//    として checkAndAddToCart() に渡す。年齢確認が必要な商品の
//    「残り数量」の追加（onAgeCheckSuccess経由）も同様に処理する。
//
// ※ 差額（priceDiff）で持つ理由：タッチパネルに表示される価格とレジ側の
//   マスタ価格の見え方が違っても（税込／税抜表示の切り替えなど）、
//   「基本価格からいくら上下したか」は変わらないため。
// ※ この修正より前に登録済みのバーコードは行に variation が無いため、
//   従来どおり基本価格で追加される（変更なし）。
//
// register.js / discount-system.js / touch-panel-order-system.js は
// 直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現する。
//
// 【導入方法】
// index.html内で、discount-system.js・touch-panel-order-system.js・
// call-staff-barcode-onetime-fix.js の3つより後ろに読み込んでください。
//   <script src="touch-panel-variation-price-carry-system.js"></script>
// ==========================================

let tpVariantRegisterItems = null; // 登録中の注文内容（registerAutomationBarcodeViaForm 実行中だけ入る）
let tpVariantActiveRow = null;     // 今まさにレジへ追加しようとしている行（processDiscountProducts 実行中だけ入る）

function tpVariantFindProductForPrice(jan) {
    let list = [];
    if (typeof getProductListForTouchPanel === 'function') list = getProductListForTouchPanel();
    if ((!Array.isArray(list) || list.length === 0) && typeof products !== 'undefined') list = products;
    return (Array.isArray(list) ? list : []).find(p => String(p.jan) === String(jan)) || null;
}

// タッチパネルの注文内容 → 自動化バーコードの商品行（variation / priceDiff 付き）
function tpVariantBuildRows(items) {
    const rows = [];
    (items || []).forEach(item => {
        if (!item || item.jan === undefined || item.jan === null) return;
        const qty = (parseInt(item.qty) > 0) ? parseInt(item.qty) : 1;
        const variation = item.variation ? String(item.variation) : '';

        let row = { jan: String(item.jan), qty };
        if (variation) {
            const prod = tpVariantFindProductForPrice(item.jan);
            const base = prod ? (Number(prod.price) || 0) : Number(item.price) || 0;
            const diff = (Number(item.price) || 0) - base;
            row.variation = variation;
            row.priceDiff = isFinite(diff) ? diff : 0;
        }

        const same = rows.find(r =>
            r.jan === row.jan &&
            (r.variation || '') === (row.variation || '') &&
            (r.priceDiff || 0) === (row.priceDiff || 0)
        );
        if (same) same.qty += row.qty; else rows.push(row);
    });
    return rows;
}

/* =========================================================
   ① 登録時：registerAutomationBarcodeViaForm() 実行中の注文内容を覚えておき、
      addDiscountBarcode() が商品行を読み取る直前に差し替える
   ========================================================= */
(function hookRegisterAutomationBarcodeForVariantCarry() {
    function tryHook() {
        if (typeof window.registerAutomationBarcodeViaForm !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.registerAutomationBarcodeViaForm;
        window.registerAutomationBarcodeViaForm = function (payload, ...rest) {
            tpVariantRegisterItems = (payload && Array.isArray(payload.items) && payload.items.length > 0) ? payload.items : null;
            try {
                return original.call(this, payload, ...rest);
            } finally {
                tpVariantRegisterItems = null;
            }
        };
    }
    tryHook();
})();

(function hookAddDiscountBarcodeForVariantCarry() {
    function tryHook() {
        if (typeof window.addDiscountBarcode !== 'function' || typeof newDiscStagedProducts === 'undefined') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.addDiscountBarcode;
        window.addDiscountBarcode = function (...args) {
            if (tpVariantRegisterItems && tpVariantRegisterItems.some(i => i && i.variation)) {
                // バリエーションが1つでもある注文のときだけ、商品行を作り直す。
                // 商品マスタに存在しない商品は、従来どおりレジ側でスキップされるだけなので
                // ここでは除外せず、ただし何も作れなかった場合は元の行をそのまま使う。
                const rows = tpVariantBuildRows(tpVariantRegisterItems);
                if (rows.length > 0) newDiscStagedProducts = rows;
            }
            return original.apply(this, args);
        };
    }
    tryHook();
})();

/* =========================================================
   ② 読み取り時：行にバリエーションがあれば、名前・価格を差し替えて追加する
   ========================================================= */
(function hookCheckAndAddToCartForVariantCarry() {
    function tryHook() {
        if (typeof window.checkAndAddToCart !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.checkAndAddToCart;
        window.checkAndAddToCart = function (prod, ...rest) {
            const row = tpVariantActiveRow;
            if (row && row.variation && prod && String(prod.jan) === String(row.jan)) {
                const base = Number(prod.price) || 0;
                const diff = Number(row.priceDiff) || 0;
                prod = Object.assign({}, prod, {
                    name: `${prod.name}（${row.variation}）`,
                    price: base + diff
                });
            }
            return original.call(this, prod, ...rest);
        };
    }
    tryHook();
})();

(function hookProcessDiscountProductsForVariantCarry() {
    function tryHook() {
        if (typeof window.processDiscountProducts !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.processDiscountProducts;
        window.processDiscountProducts = function (disc, idx, ...rest) {
            // 自分自身を再帰的に呼ぶ実装（次の行へ進む）でも、行ごとに正しく切り替わる
            tpVariantActiveRow = (disc && Array.isArray(disc.products)) ? (disc.products[idx] || null) : null;
            try {
                return original.call(this, disc, idx, ...rest);
            } finally {
                tpVariantActiveRow = null;
            }
        };
    }
    tryHook();
})();

// 年齢確認が必要な商品：確認後に「残り数量」を追加する処理も、同じ行の価格で追加する
(function hookOnAgeCheckSuccessForVariantCarry() {
    function tryHook() {
        if (typeof window.onAgeCheckSuccess !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.onAgeCheckSuccess;
        window.onAgeCheckSuccess = function (...args) {
            if (typeof pendingDiscountQueue !== 'undefined' && pendingDiscountQueue && pendingDiscountQueue.disc) {
                const { disc, idx } = pendingDiscountQueue;
                tpVariantActiveRow = (Array.isArray(disc.products) ? disc.products[idx] : null) || null;
            }
            try {
                return original.apply(this, args);
            } finally {
                tpVariantActiveRow = null;
            }
        };
    }
    tryHook();
})();
