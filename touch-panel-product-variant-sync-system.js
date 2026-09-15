// ==========================================
// touch-panel-product-variant-sync-system.js
// ------------------------------------------
// 【背景・今回直したいこと】
// バリエーション（サイズ・種類など）の設定場所が、実はこれまで2箇所に
// 分かれてしまっていた。
//   ① 商品管理画面の「🎨 バリエーション設定」（product-variant-system.js）
//      → pos_product_variants に保存。グループ名・選択肢ごとの価格上書きに対応。
//      → ただし反映されるのは「レジ画面（generateCustomButtons）」の
//        ボタンだけで、タッチパネル注文画面には一切表示されなかった。
//   ② タッチパネルの商品詳細ポップアップ内にある「🔀 バリエーション設定」
//      （touch-panel-order-system.js）
//      → pos_touch_panel_variations_{jan} に保存。カンマ区切りの文字列だけで、
//        価格上書きには対応していない。
//
// この2つが別々の場所に保存されるせいで、①だけを設定していると
// タッチパネル側では「バリエーションが無い商品」として扱われてしまい、
// お客様（赤の他人）がタッチパネルで注文する際にサイズ・種類を選べない
// （＝価格違いのバリエーションがあっても常に基本価格になってしまう）
// という問題があった。
//
// 【対応】
// タッチパネルの商品詳細ポップアップが表示するバリエーション一覧を、
// 次の優先順位で解決するようにする（保存先そのものは変更しない。
// あくまで「表示・価格計算だけ」を統合する）。
//   1. タッチパネル専用の個別設定（pos_touch_panel_variations_{jan}）
//      …店員がタッチパネル側で直接カンマ区切り設定した場合はそれを優先
//   2. 商品管理画面の「🎨 バリエーション設定」（pos_product_variants）
//      …グループ名・選択肢ごとの価格上書きも反映される
//   3. 固定リスト（TOUCH_PANEL_PRODUCT_VARIATIONS）
//
// register.js / touch-panel-order-system.js / product-variant-system.js は
// 直接編集せず、このファイルからフック（関数の安全な上書き）で対応する。
// ==========================================

/**
 * 指定JANのバリエーション一覧を { groupLabel, options:[{label, price}] } の形で返す。
 * price が null/undefined の選択肢は「商品の基本価格をそのまま使う」という意味。
 * 該当するバリエーション設定が一切無ければ null を返す。
 */
function getTouchPanelVariantOptionsWithPrice(jan) {
    // 1. タッチパネル専用の個別設定（価格上書きには対応していない）
    try {
        const raw = localStorage.getItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + jan);
        if (raw !== null) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) {
                return { groupLabel: '', options: arr.map(label => ({ label, price: null })) };
            }
        }
    } catch (e) { /* 読み込みに失敗した場合は次の優先度へフォールバック */ }

    // 2. 商品管理画面の「🎨 バリエーション設定」（product-variant-system.js）
    if (typeof getProductVariants === 'function') {
        const config = getProductVariants(jan);
        if (config && Array.isArray(config.options) && config.options.length > 0) {
            return { groupLabel: config.groupLabel || '', options: config.options };
        }
    }

    // 3. 固定リストのフォールバック（既存の挙動を維持）
    if (typeof TOUCH_PANEL_PRODUCT_VARIATIONS !== 'undefined' && TOUCH_PANEL_PRODUCT_VARIATIONS[jan]) {
        return { groupLabel: '', options: TOUCH_PANEL_PRODUCT_VARIATIONS[jan].map(label => ({ label, price: null })) };
    }

    return null;
}

// 選択中のラベルに価格上書きが設定されていれば、その金額を返す（無ければnull）
function getTouchPanelVariantPriceOverride(jan, label) {
    if (!label) return null;
    const info = getTouchPanelVariantOptionsWithPrice(jan);
    if (!info) return null;
    const opt = info.options.find(o => o.label === label);
    return (opt && opt.price !== null && opt.price !== undefined) ? Number(opt.price) : null;
}

/* =========================================================
   openTouchPanelItemModal() を上書きし、初期選択（draft.variation）を
   統合後のバリエーション一覧から決めるようにする。
   ========================================================= */
(function overrideOpenTouchPanelItemModalForVariantSync() {
    function tryHook() {
        if (typeof window.openTouchPanelItemModal !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.openTouchPanelItemModal = function (jan) {
            const productList = getProductListForTouchPanel();
            const product = productList.find(p => String(p.jan) === String(jan));
            if (!product) return;
            tpPlaySound('click');

            const variantInfo = getTouchPanelVariantOptionsWithPrice(jan);
            const firstLabel = (variantInfo && variantInfo.options.length > 0) ? variantInfo.options[0].label : null;

            touchPanelState.modalDraft = {
                jan: product.jan,
                variation: firstLabel,
                qty: 1
            };
            renderTouchPanelItemModal(product, null);
        };
    }
    tryHook();
})();

/* =========================================================
   renderTouchPanelItemModal() を上書きし、
   商品管理画面で設定したバリエーション（価格上書き含む）も
   選択肢として表示・合計金額へ反映されるようにする。
   ------------------------------------------
   第2引数（variations）は元の実装では「文字列の配列」を受け取っていたが、
   価格情報を持てないためここでは使わず、常にこのファイル内で
   getTouchPanelVariantOptionsWithPrice() を呼び直して算出する
   （呼び出し側の引数はそのままで問題ない）。
   ========================================================= */
(function overrideRenderTouchPanelItemModalForVariantSync() {
    function tryHook() {
        if (typeof window.renderTouchPanelItemModal !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.renderTouchPanelItemModal = function (product) {
            const modalRoot = ensureTouchPanelItemModalRoot();
            const draft = touchPanelState.modalDraft;
            if (!modalRoot || !draft) return;

            const variantInfo = getTouchPanelVariantOptionsWithPrice(product.jan);
            const options = variantInfo ? variantInfo.options : [];

            const imgUrl = getTouchPanelProductImg(product.jan);
            const desc = getTouchPanelDesc(product.jan);
            const isStaff = touchPanelState.mode === 'staff';
            const basePrice = typeof product.price === 'number' ? product.price : 0;
            const variantPrice = getTouchPanelVariantPriceOverride(product.jan, draft.variation);
            const priceEach = variantPrice !== null ? variantPrice : basePrice;
            const total = priceEach * draft.qty;
            const reco = isRecommendedJan(product.jan);

            const sectionLabel = (variantInfo && variantInfo.groupLabel)
                ? `${variantInfo.groupLabel}を選んでください`
                : 'サイズ・種類を選んでください';

            const variationHtml = options.length > 0 ? `
        <div class="tp-modal-section-label">${tpEsc(sectionLabel)}</div>
        <div class="tp-modal-variations">
            ${options.map(o => {
                const p = (o.price !== null && o.price !== undefined) ? Number(o.price) : basePrice;
                const priceDiffHtml = p !== basePrice ? `<small>（¥${p.toLocaleString()}）</small>` : '';
                return `<button class="tp-chip ${draft.variation === o.label ? 'active' : ''}" onclick="selectTouchPanelModalVariation('${tpAttr(o.label)}')">${tpEsc(o.label)}${priceDiffHtml}</button>`;
            }).join('')}
        </div>
    ` : '';

            const staffHtml = isStaff ? `
        <div class="tp-modal-staff-box">
            <div class="tp-modal-section-label" style="margin-top:0;">🧑‍💼 店員用設定</div>
            <div class="tp-modal-staff-actions">
                <button class="tp-btn tp-cancel" onclick="setTouchPanelProductImgPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🖼️ 写真を設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelProductImgUrlPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🔗 URLで設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelDescPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">📝 説明文を設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelVariationsPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🔀 バリエーション設定（タッチパネル専用・価格上書き無し）</button>
                <button class="tp-btn ${reco ? 'tp-reco-on' : 'tp-cancel'}" onclick="toggleRecommendedJan('${tpAttr(product.jan)}')">⭐ ${reco ? 'おすすめ解除' : 'おすすめに追加'}</button>
            </div>
            <div style="font-size:11px; color:#888; margin-top:6px;">※ 価格違いのバリエーションは、商品管理画面の「🎨 バリエーション設定」で設定してください。</div>
        </div>
    ` : '';

            modalRoot.innerHTML = `
        <div class="tp-modal-backdrop" onclick="closeTouchPanelItemModal()"></div>
        <div class="tp-item-modal tp-slide-up">
            <div class="tp-item-modal-drag-handle"></div>
            <button class="tp-modal-close" aria-label="閉じる" onclick="closeTouchPanelItemModal()">×</button>
            <div class="tp-item-modal-photo" style="${imgUrl ? `background-image:url('${tpCssStr(imgUrl)}');` : ''}">
                ${imgUrl ? '' : '<span class="tp-item-modal-photo-placeholder">🍽️</span>'}
                ${reco ? '<span class="tp-badge-reco">⭐ おすすめ</span>' : ''}
            </div>
            <div class="tp-item-modal-body">
                <div class="tp-item-modal-name">${tpEsc(product.name || '(名称未設定)')}</div>
                ${desc ? `<div class="tp-item-modal-desc">${tpEsc(desc)}</div>` : ''}
                <div class="tp-item-modal-price">¥${priceEach.toLocaleString()}</div>
                ${variationHtml}
                <div class="tp-modal-section-label">数量</div>
                <div class="tp-qty-stepper">
                    <button onclick="changeTouchPanelModalQty(-1)" aria-label="数量を減らす">－</button>
                    <span id="tp-modal-qty">${draft.qty}</span>
                    <button onclick="changeTouchPanelModalQty(1)" aria-label="数量を増やす">＋</button>
                </div>
                ${staffHtml}
                <button class="tp-btn tp-confirm tp-modal-add-btn" onclick="confirmAddTouchPanelModalItem()">🛒 カートに追加（¥${total.toLocaleString()}）</button>
            </div>
        </div>
    `;
        };
    }
    tryHook();
})();

/* =========================================================
   addItemToTouchPanelOrder() を上書きし、選択したバリエーションに
   価格上書きが設定されている場合はその金額をカートに使う。
   （元の実装は常に product.price を使っていたため、商品管理画面側で
   　設定した価格違いのバリエーションが注文金額に反映されなかった）
   ========================================================= */
(function overrideAddItemToTouchPanelOrderForVariantSync() {
    function tryHook() {
        if (typeof window.addItemToTouchPanelOrder !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.addItemToTouchPanelOrder = function (product, variation, qty) {
            qty = qty || 1;
            const variantPrice = getTouchPanelVariantPriceOverride(product.jan, variation);
            const priceEach = variantPrice !== null ? variantPrice : (typeof product.price === 'number' ? product.price : 0);

            const existing = touchPanelState.order.find(i => i.jan === product.jan && i.variation === variation);
            if (existing) {
                existing.qty += qty;
            } else {
                touchPanelState.order.push({
                    jan: product.jan,
                    name: product.name,
                    price: priceEach,
                    variation: variation || null,
                    qty: qty
                });
            }
            renderTouchPanelOrderList();
        };
    }
    tryHook();
})();
