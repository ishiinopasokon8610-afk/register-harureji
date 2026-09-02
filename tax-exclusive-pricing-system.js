// ==========================================
// tax-exclusive-pricing-system.js
// ------------------------------------------
// 【背景】
// register.js の addToCart() は、渡された price をそのまま「税込価格」
// として扱う設計になっている（合計・消費税内訳・税区分集計などは、
// 全て「price は税込」という前提で計算されている）。
// しかし、商品管理で価格を税抜きで登録しているお店の場合、
// このままではレシートの合計に消費税が上乗せされず、税抜き価格が
// そのまま税込価格として扱われてしまう（実質、税抜きで販売してしまう）。
//
// 【この機能】
// データ管理画面に「✅ 商品価格は税抜きで登録している」を追加する。
// ONの場合、addToCart() に渡される price を、その商品のtaxRateを使って
//   税込価格 = 税抜価格 × (100 + taxRate) / 100
// に自動変換してからカートに追加する（四捨五入）。
// これにより、商品管理側の登録は税抜きのままで、レジでの会計・
// レシート・消費税内訳（tax-report-system.js）は正しく税込で計算される。
//
// register.js / order-system-settings.js / index.html は直接編集せず、
// addToCart() をラップして実現する（他の追加機能ファイルと同じ「フック方式」）。
// ==========================================

const TAX_EXCLUSIVE_PRICING_KEY = 'pos_tax_exclusive_pricing_enabled';

function isTaxExclusivePricingEnabled() {
    return localStorage.getItem(TAX_EXCLUSIVE_PRICING_KEY) === 'true';
}

// ★チェックボックスの見た目は「✅ 商品価格は税込みで登録している」（税込み登録＝チェックON）に
// している。内部の保存値（TAX_EXCLUSIVE_PRICING_KEY）は従来どおり「税抜き登録なら true」の
// 意味のまま扱うため、チェックのON/OFFとは逆の値を保存する。
function toggleTaxExclusivePricing() {
    const cb = document.getElementById('tax-exclusive-pricing-check');
    const isTaxInclusiveChecked = !!(cb && cb.checked); // ✅=税込み登録
    localStorage.setItem(TAX_EXCLUSIVE_PRICING_KEY, isTaxInclusiveChecked ? 'false' : 'true');
    if (typeof playSound === 'function') playSound('click');
}

// 税抜価格 → 税込価格（四捨五入）
function convertToTaxInclusivePrice(price, taxRate) {
    const rate = Number(taxRate) || 0;
    if (rate <= 0) return price;
    return Math.round(Number(price) * (100 + rate) / 100);
}

/* =========================================================
   ① データ管理画面に設定ブロックを追加する
   ========================================================= */
function ensureTaxExclusivePricingBlock() {
    if (document.getElementById('tax-exclusive-pricing-block')) {
        syncTaxExclusivePricingCheckbox();
        return;
    }
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'tax-exclusive-pricing-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#e1f5fe; border:2px solid #0288d1; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#01579b;">🧾 商品価格の税抜き／税込み設定</h3>
        <label style="font-weight:bold; display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <input type="checkbox" id="tax-exclusive-pricing-check" onchange="toggleTaxExclusivePricing()">
            ✅ 商品価格は税込みで登録している
        </label>
        <p style="font-size:12px; color:#0277bd; margin:6px 0 0;">
            通常はこちら（✅）のままでOKです。登録されている価格をそのまま会計金額として扱います。<br>
            商品管理で価格を<b>税抜き</b>で登録しているお店の場合のみ、チェックを外してください。
            OFFにすると、レジで商品をスキャン・追加した時に、登録されている価格へ
            自動で消費税（各商品の税率）を上乗せしてから会計に反映します。
        </p>
    `;
    container.appendChild(block);
    syncTaxExclusivePricingCheckbox();
}

function syncTaxExclusivePricingCheckbox() {
    const cb = document.getElementById('tax-exclusive-pricing-check');
    if (cb) cb.checked = !isTaxExclusivePricingEnabled(); // ✅=税込み登録なので、内部値（税抜きtrue）とは逆にする
}

(function hookShowScreenForTaxExclusivePricing() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureTaxExclusivePricingBlock();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② addToCart() をラップし、税抜き価格を税込みに変換する
   ------------------------------------------
   免税適用（taxExemptTransaction）は addToCart() 内部で
   「渡されたpriceは税込み」という前提で税抜き後の価格を計算しているため、
   ここでの変換は必ず addToCart() の「前」に行う
   （＝オリジナルのaddToCart()からすれば、常に税込価格を受け取ったのと
   同じ状態になるようにする）。
   ========================================================= */
(function hookAddToCartForTaxExclusivePricing() {
    function tryHook() {
        if (typeof window.addToCart !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.addToCart;
        window.addToCart = function (name, price, taxRate = 10, genre = 'その他商品') {
            let finalPrice = price;
            if (isTaxExclusivePricingEnabled()) {
                finalPrice = convertToTaxInclusivePrice(price, taxRate);
            }
            return original.call(this, name, finalPrice, taxRate, genre);
        };
    }
    tryHook();
})();
