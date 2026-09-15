// ==========================================
// touch-panel-tax-exclusive-price-display-fix-system.js
// ------------------------------------------
// 【背景】
// touch-panel-price-tax-included-label-system.js は「（税込）」という
// 文字を追加するだけで、金額の計算自体は一切変えていなかった。
// しかし実際には商品価格が税抜きで登録されているとのことなので、
// タッチパネル側の金額表示（商品カード・おすすめバナー・商品詳細・
// カート・注文履歴）が、税抜きの金額のまま表示されてしまっていた。
//
// 一方、tax-exclusive-pricing-system.js（データ管理画面の
// 「✅ 商品価格は税込みで登録している」設定）は、本体レジ（register.js）
// の addToCart() をラップして、税抜き登録の場合に税込み金額へ自動変換
// する仕組みをすでに持っている。このファイルは、その同じ設定・同じ
// 変換ロジック（isTaxExclusivePricingEnabled() / convertToTaxInclusivePrice()）
// をそのまま利用して、タッチパネル側の「表示」も税込み金額になるようにする。
//
// 【重要：このファイルが変えるのは「表示」だけ】
// touchPanelState.order（カートの中身）や、注文送信時に
// registerAutomationBarcodeViaForm() へ渡す items の中身（price）は、
// 一切書き換えていない。書き換えてしまうと、店員が本体レジで自動化
// バーコードを読み込んだ際に、すでに税込みになった金額へさらに
// addToCart()側の変換がかかってしまい、二重に税が乗ってしまう
// おそれがあるため。
// そのため、画面に「表示する数字」だけをその場で税込み計算し直し、
// 保存されているデータ自体（price）は今まで通り税抜きのまま
// 保持している。
//
// 【前提にしていること・ご確認のお願い】
// ・商品マスタの各商品オブジェクトに taxRate（8 / 10 など）という
// 　プロパティがある前提で計算している（tax-exclusive-pricing-system.js
// 　の addToCart(name, price, taxRate = 10, genre) という引数名から、
// 　商品ごとに taxRate を持っていると判断した）。もしプロパティ名が
// 　違う場合は教えてください。
// ・touchPanelState.order の各行には現状 taxRate が保存されていない
// 　ため、表示のたびに商品マスタ（jan）から taxRate を引き直している。
// ・実際にお会計で店員が自動化バーコードを読み込んだ時に本当に
// 　税込み金額で計算されているかどうかは、registerAutomationBarcodeViaForm()
// 　や、その先で実行される処理の中身が見えていないため確認できていない。
// 　もしお会計時の金額もまだ税抜きのままだった場合は、その処理を
// 　行っているファイルを教えてください。
// ==========================================

/* 税抜き登録が有効な場合だけ、税込み金額に変換して返す。
   tax-exclusive-pricing-system.js が読み込まれていない・まだ実行されて
   いない場合は、これまで通り元の金額をそのまま返す（安全側に倒す）。 */
function tpDisplayInclusivePrice(price, taxRate) {
    if (typeof price !== 'number') return price;
    if (typeof isTaxExclusivePricingEnabled !== 'function' || typeof convertToTaxInclusivePrice !== 'function') {
        return price;
    }
    if (!isTaxExclusivePricingEnabled()) return price;
    return convertToTaxInclusivePrice(price, taxRate);
}

// 商品一覧（jan一致）から taxRate を引く。見つからない場合や未設定の
// 場合は、addToCart() 側のデフォルトと合わせて 10 を返す。
function tpGetTaxRateForJan(jan) {
    const list = (typeof getProductListForTouchPanel === 'function') ? getProductListForTouchPanel() : [];
    const found = list.find(p => String(p.jan) === String(jan));
    return (found && typeof found.taxRate === 'number') ? found.taxRate : 10;
}

/* =========================================================
   ① 商品カード／おすすめバナー／商品詳細モーダル
   ------------------------------------------
   これらは商品オブジェクト（p / product）を引数で受け取って描画する
   関数なので、price だけを税込みに変換した「複製」を作って、その
   複製を元関数に渡す（元の商品オブジェクト自体は書き換えない）。
   ========================================================= */
function tpHookFunctionWithConvertedProductArg(fnName, productArgIndex) {
    function tryHook() {
        if (typeof window[fnName] !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window[fnName];
        window[fnName] = function (...args) {
            const p = args[productArgIndex];
            if (p && typeof p.price === 'number') {
                const converted = { ...p, price: tpDisplayInclusivePrice(p.price, tpGetTaxRateForJan(p.jan)) };
                args = [...args];
                args[productArgIndex] = converted;
            }
            return original.apply(this, args);
        };
    }
    tryHook();
}
tpHookFunctionWithConvertedProductArg('renderTouchPanelBannerCard', 0);
tpHookFunctionWithConvertedProductArg('renderTouchPanelMenuCard', 0);
tpHookFunctionWithConvertedProductArg('renderTouchPanelItemModal', 0);

/* =========================================================
   ② カートかごバー／カートドロワー
   ------------------------------------------
   これらは引数を取らず、関数内部で touchPanelState.order を直接
   参照して描画している。そのため、元関数を呼び出す「間だけ」
   touchPanelState.order を、priceを税込みに変換した複製に一時的に
   差し替え、呼び出しが終わったら元の配列に戻す。
   ========================================================= */
function tpBuildDisplayConvertedOrder() {
    return (touchPanelState.order || []).map(item => ({
        ...item,
        price: tpDisplayInclusivePrice(item.price, tpGetTaxRateForJan(item.jan))
    }));
}

function tpHookFunctionWithConvertedOrderState(fnName) {
    function tryHook() {
        if (typeof window[fnName] !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window[fnName];
        window[fnName] = function (...args) {
            const realOrder = touchPanelState.order;
            touchPanelState.order = tpBuildDisplayConvertedOrder();
            try {
                return original.apply(this, args);
            } finally {
                touchPanelState.order = realOrder;
            }
        };
    }
    tryHook();
}
tpHookFunctionWithConvertedOrderState('updateTouchPanelCartBar');
tpHookFunctionWithConvertedOrderState('renderTouchPanelCartDrawer');

/* =========================================================
   ③ 注文履歴（すでに送信済みの注文一覧）
   ------------------------------------------
   touchPanelState.sentOrders の各注文は { items, total, time } という
   形で保存されている。items内のpriceを税込みに変換し、totalもその
   変換後のitemsから計算し直した複製を使う。
   ========================================================= */
function tpBuildDisplayConvertedSentOrders() {
    return (touchPanelState.sentOrders || []).map(order => {
        const items = (order.items || []).map(item => ({
            ...item,
            price: tpDisplayInclusivePrice(item.price, tpGetTaxRateForJan(item.jan))
        }));
        const total = items.reduce((s, i) => s + i.price * i.qty, 0);
        return { ...order, items, total };
    });
}

(function hookRenderTouchPanelOrderHistoryModal() {
    function tryHook() {
        if (typeof window.renderTouchPanelOrderHistoryModal !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.renderTouchPanelOrderHistoryModal;
        window.renderTouchPanelOrderHistoryModal = function (...args) {
            const realSentOrders = touchPanelState.sentOrders;
            touchPanelState.sentOrders = tpBuildDisplayConvertedSentOrders();
            try {
                return original.apply(this, args);
            } finally {
                touchPanelState.sentOrders = realSentOrders;
            }
        };
    }
    tryHook();
})();
