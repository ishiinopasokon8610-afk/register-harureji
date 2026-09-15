// ==========================================
// product-tax-rate-bulk-change-system.js
// ------------------------------------------
// このファイルも index.html / register.js を直接編集せず、
// 他の追加機能ファイルと同じ「フック/DOM注入方式」で実現している。
// （index.html に、このファイルを読み込む <script> タグを1行追加するだけ）
//
// 【今回の対応】
// データ管理画面（migration-screen）に「🔁 税率をまとめて変更」ブロックを
// 追加する。「今の税率（%）」「変更後の税率（%）」の2つの欄に数字を
// 入力して実行すると、今の税率に一致するすべての商品の taxRate を
// まとめて書き換える（商品管理から1件ずつ税率を直す手間を省くため）。
//
// tax-exclusive-pricing-system.js が migration-screen に同じ形で
// ブロックを追加しているのと同じ考え方・同じ場所（showScreen() を
// フックして 'migration-screen' が表示された時にブロックを差し込む）
// で実装している。
//
// 【前提にしていること・ご確認のお願い】
// ・商品データは、touch-panel-order-system.js の
// 　getProductListForTouchPanel()（getProductListSafe() があればそれを、
// 　無ければグローバル変数 products をそのまま使う実装）と同じ考え方で
// 　取得している。products が実際に商品管理画面と同じ配列（参照）を
// 　指していれば、書き換えた内容はその場で商品管理の画面にも反映される
// 　はず。もし商品管理画面の一覧がその場で更新されない場合は、
// 　商品一覧の再描画関数名（例: renderProducts など）を教えてください。
// ・保存先のlocalStorageキーは、local-backup.js 等で使われている
// 　'pos_products' を前提にしている。
// ・各商品の税率フィールド名は、tax-exclusive-pricing-system.js の
// 　addToCart(name, price, taxRate = 10, genre) という引数名から
// 　taxRate と判断している。
// ==========================================

/* =========================================================
   ① データ管理画面にブロックを追加する
   ========================================================= */
function ensureTaxRateBulkChangeBlock() {
    if (document.getElementById('tax-rate-bulk-change-block')) return;
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'tax-rate-bulk-change-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#fff3e0; border:2px solid #fb8c00; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#e65100;">🔁 税率をまとめて変更</h3>
        <p style="font-size:12px; color:#e65100; margin:0 0 10px;">
            指定した税率の商品を、全件まとめて別の税率に変更します（商品管理から1件ずつ直す手間を省けます）。
            例：食料品の税率を 8% → 10% に一括変更、など。
        </p>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <label style="font-size:13px; font-weight:bold; display:flex; align-items:center; gap:4px;">
                今の税率
                <input type="number" id="tax-rate-bulk-before" value="8" min="0" max="100" step="0.1" style="width:70px; padding:4px;">
                %
            </label>
            <span style="font-size:16px;">→</span>
            <label style="font-size:13px; font-weight:bold; display:flex; align-items:center; gap:4px;">
                変更後の税率
                <input type="number" id="tax-rate-bulk-after" value="10" min="0" max="100" step="0.1" style="width:70px; padding:4px;">
                %
            </label>
            <button type="button" class="btn-migration" onclick="runTaxRateBulkChange()"
                style="padding:8px 14px; border:none; border-radius:6px; background:#fb8c00; color:#fff; font-weight:bold; cursor:pointer;">
                変更する
            </button>
        </div>
        <p id="tax-rate-bulk-result" style="font-size:12px; color:#555; margin:8px 0 0;"></p>
    `;
    container.appendChild(block);
}

(function hookShowScreenForTaxRateBulkChange() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureTaxRateBulkChangeBlock();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ② 実行処理
   ========================================================= */
function getEditableProductListForBulkTaxChange() {
    if (typeof getProductListSafe === 'function') {
        const list = getProductListSafe();
        if (Array.isArray(list)) return list;
    }
    if (typeof products !== 'undefined' && Array.isArray(products)) return products;
    return null;
}

// 商品一覧の画面がその場で更新されるよう、想定される再描画関数が
// あれば呼んでおく（関数名が分からないため、代表的な候補だけ試す。
// どれも無ければ何もしない＝データ自体は保存済みなので、商品管理画面を
// 開き直せば反映される）
function refreshProductScreenIfPossible() {
    ['renderProducts', 'renderProductList', 'renderProductTable', 'refreshProductList'].forEach(fnName => {
        if (typeof window[fnName] === 'function') {
            try { window[fnName](); } catch (e) { /* 無視 */ }
        }
    });
}

function applyTaxRateBulkChange(before, after) {
    const list = getEditableProductListForBulkTaxChange();
    const resultEl = document.getElementById('tax-rate-bulk-result');
    if (!list) {
        if (resultEl) resultEl.innerText = '商品データが見つかりませんでした。';
        return;
    }

    let count = 0;
    list.forEach(p => {
        if (Number(p.taxRate) === before) {
            p.taxRate = after;
            count++;
        }
    });

    try {
        localStorage.setItem('pos_products', JSON.stringify(list));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    } catch (e) {
        console.warn('税率のまとめて変更の保存に失敗しました:', e);
    }

    if (typeof playSound === 'function') playSound('success');
    if (resultEl) {
        resultEl.innerText = count > 0
            ? `${count}件の商品を、税率${before}%→${after}%に変更しました。`
            : `税率${before}%の商品は見つかりませんでした（変更なし）。`;
    }

    refreshProductScreenIfPossible();
}

function runTaxRateBulkChange() {
    const beforeInput = document.getElementById('tax-rate-bulk-before');
    const afterInput = document.getElementById('tax-rate-bulk-after');
    const resultEl = document.getElementById('tax-rate-bulk-result');

    const before = Number(beforeInput && beforeInput.value);
    const after = Number(afterInput && afterInput.value);

    if (beforeInput && beforeInput.value === '' || afterInput && afterInput.value === '' || isNaN(before) || isNaN(after)) {
        if (resultEl) resultEl.innerText = '税率は数字で入力してください。';
        return;
    }

    if (typeof playSound === 'function') playSound('click');

    const message = `税率${before}%の商品（全件）を、税率${after}%に変更します。よろしいですか？`;
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            message,
            `ぜいりつ ${before} ぱーせんと の しょうひん を、 ぜいりつ ${after} ぱーせんと に へんこう し ます。 よろしい です か？`,
            (ok) => { if (ok) applyTaxRateBulkChange(before, after); },
            true
        );
    } else if (window.confirm(message)) {
        applyTaxRateBulkChange(before, after);
    }
}
