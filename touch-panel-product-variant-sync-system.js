// ==========================================
// touch-panel-product-variant-sync-system.js
// ------------------------------------------
// 【背景】
// バリエーション（サイズ・種類など）の設定場所が、実はこれまで2箇所に
// 分かれてしまっていた。
//   ① 商品管理画面の「🎨 バリエーション設定」（product-variant-system.js）
//      → pos_product_variants に保存。質問（グループ）ごとに複数選択肢・
//        複数選択・価格差額に対応。
//      → ただし反映されるのは「レジ画面（generateCustomButtons）」の
//        ボタンだけで、タッチパネル注文画面には一切表示されなかった。
//   ② タッチパネルの商品詳細ポップアップ内にある「🔀 バリエーション設定」
//      （touch-panel-order-system.js）
//      → pos_touch_panel_variations_{jan} に保存。カンマ区切りの文字列だけで、
//        価格差額・複数選択には対応していない。
//
// この2つが別々の場所に保存されるせいで、①だけを設定していると
// タッチパネル側では「バリエーションが無い商品」として扱われてしまい、
// お客様（赤の他人）がタッチパネルで注文する際にサイズ・種類を選べない
// （＝価格違いのバリエーションがあっても常に基本価格になってしまう）
// という問題があった。
//
// 【今回の変更】
// product-variant-system.js が「質問を複数追加できる・複数選択できる・
// 価格は＋／－の差額で指定する」構成にリニューアルされたのに合わせて、
// タッチパネル側の表示・金額計算もそれに追従させた。
//   ・商品詳細ポップアップに、質問（サイズ／トッピングなど）ごとの
//     選択欄をすべて表示するようにした。
//   ・「複数選択できる」質問はチェックボックスのように複数選べるように
//     し、選ばれた選択肢すべての差額を合計して金額に反映するように
//     した。
//   ・カートへの保存自体（item.variation が文字列であること等）は
//     従来通りの形を維持している（レシート表示・注文一覧など、
//     このファイルの外側にある既存コードを変更せずに済ませるため）。
//     複数の選択肢が選ばれた場合は「・」で連結した文字列にする
//     （例：「中盛・チーズ」）。
//
// タッチパネル専用の個別設定（①より優先度の低い、価格差額に対応しない
// カンマ区切りのシンプルな設定）は、これまで通り「単一選択・差額なし」
// の質問1つとして扱う（保存先そのものは変更しない）。
//
// 表示・金額計算は次の優先順位で解決する（あくまで「表示・価格計算だけ」
// を統合する。保存先そのものは変更しない）。
//   1. タッチパネル専用の個別設定（pos_touch_panel_variations_{jan}）
//      …店員がタッチパネル側で直接カンマ区切り設定した場合はそれを優先
//   2. 商品管理画面の「🎨 バリエーション設定」（pos_product_variants）
//      …質問の複数追加・複数選択・価格差額もすべて反映される
//   3. 固定リスト（TOUCH_PANEL_PRODUCT_VARIATIONS）
//
// register.js / touch-panel-order-system.js / product-variant-system.js は
// 直接編集せず、このファイルからフック（関数の安全な上書き）で対応する。
// ==========================================

/**
 * 指定JANの質問一覧を { questions:[{label, multi, options:[{label,sign,amount,price?}]}] }
 * の形で返す。該当するバリエーション設定が一切無ければ null を返す。
 */
function getTouchPanelVariantOptionsWithPrice(jan) {
    // 1. タッチパネル専用の個別設定（価格差額・複数選択には対応していない）
    try {
        const raw = localStorage.getItem(TOUCH_PANEL_VARIATIONS_STORAGE_PREFIX + jan);
        if (raw !== null) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) {
                return { questions: [{ label: '', multi: false, options: arr.map(label => ({ label, sign: '+', amount: 0 })) }] };
            }
        }
    } catch (e) { /* 読み込みに失敗した場合は次の優先度へフォールバック */ }

    // 2. 商品管理画面の「🎨 バリエーション設定」（product-variant-system.js）
    //    ※ getProductVariants() が返す形式が、そのままこの関数の戻り値の形式と一致する
    if (typeof getProductVariants === 'function') {
        const config = getProductVariants(jan);
        if (config && Array.isArray(config.questions) && config.questions.length > 0) {
            return config;
        }
    }

    // 3. 固定リストのフォールバック（既存の挙動を維持）
    if (typeof TOUCH_PANEL_PRODUCT_VARIATIONS !== 'undefined' && TOUCH_PANEL_PRODUCT_VARIATIONS[jan]) {
        return { questions: [{ label: '', multi: false, options: TOUCH_PANEL_PRODUCT_VARIATIONS[jan].map(label => ({ label, sign: '+', amount: 0 })) }] };
    }

    return null;
}

// 選択肢1つぶんの最終価格を計算する。product-variant-system.js の
// computeVariantOptionPrice() が読み込まれていればそれを使い、無い場合
// （読み込み順の都合など）に備えて同じロジックをこのファイル内にも持つ。
function tpComputeOptionPrice(basePrice, opt) {
    if (typeof computeVariantOptionPrice === 'function') return computeVariantOptionPrice(basePrice, opt);
    const base = Number(basePrice) || 0;
    if (opt && opt.price !== null && opt.price !== undefined && opt.price !== '') return Number(opt.price);
    const amount = Number(opt && opt.amount) || 0;
    const sign = (opt && opt.sign === '-') ? -1 : 1;
    return base + sign * amount;
}

// 質問配列 × 選択済みラベルの配列（draft.selections と同じ形）から、
// 合計価格・選ばれた選択肢名の一覧を計算する
function tpComputeSelectionsSummary(basePrice, questions, selections) {
    const labels = [];
    let total = Number(basePrice) || 0;
    (questions || []).forEach((q, qIdx) => {
        ((selections && selections[qIdx]) || []).forEach(label => {
            const opt = (q.options || []).find(o => o.label === label);
            if (!opt) return;
            labels.push(label);
            total += tpComputeOptionPrice(basePrice, opt) - (Number(basePrice) || 0);
        });
    });
    return { labels, total };
}

function tpFormatPriceDiff(diff) {
    if (!diff) return '';
    return diff > 0 ? `+¥${diff.toLocaleString()}` : `-¥${Math.abs(diff).toLocaleString()}`;
}

// チップ（選択肢ボタン）がクリックされた時の共通処理。
// 単一選択の質問はそのラベル1つだけに置き換え、複数選択の質問は
// クリックされたラベルをトグル（選択/解除）する。
window.selectTouchPanelModalVariantOption = function (qIdx, label) {
    const draft = touchPanelState.modalDraft;
    if (!draft) return;
    const variantInfo = getTouchPanelVariantOptionsWithPrice(draft.jan);
    if (!variantInfo || !variantInfo.questions[qIdx]) return;
    const q = variantInfo.questions[qIdx];

    tpPlaySound('click');

    if (!draft.selections) draft.selections = [];
    if (!draft.selections[qIdx]) draft.selections[qIdx] = [];
    const cur = draft.selections[qIdx];

    if (q.multi) {
        const pos = cur.indexOf(label);
        if (pos === -1) cur.push(label); else cur.splice(pos, 1);
    } else {
        draft.selections[qIdx] = [label];
    }

    const productList = getProductListForTouchPanel();
    const product = productList.find(p => String(p.jan) === String(draft.jan));
    if (product) renderTouchPanelItemModal(product);
};

/* =========================================================
   openTouchPanelItemModal() を上書きし、初期選択（draft.selections）を
   統合後の質問一覧から決めるようにする。
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
            // 単一選択の質問は先頭の選択肢を初期選択、複数選択の質問は未選択で開始する
            const selections = variantInfo
                ? variantInfo.questions.map(q => q.multi ? [] : (q.options && q.options[0] ? [q.options[0].label] : []))
                : [];

            touchPanelState.modalDraft = {
                jan: product.jan,
                selections: selections,
                qty: 1
            };
            renderTouchPanelItemModal(product, null);
        };
    }
    tryHook();
})();

/* =========================================================
   renderTouchPanelItemModal() を上書きし、
   商品管理画面で設定した質問（複数・複数選択・価格差額含む）も
   選択肢として表示・合計金額へ反映されるようにする。
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
            const questions = variantInfo ? variantInfo.questions : [];

            // 選択状態の配列が質問数と噛み合わない場合（初回描画時など）は作り直す
            if (!draft.selections || draft.selections.length !== questions.length) {
                draft.selections = questions.map(q => q.multi ? [] : (q.options && q.options[0] ? [q.options[0].label] : []));
            }

            const imgUrl = getTouchPanelProductImg(product.jan);
            const desc = getTouchPanelDesc(product.jan);
            const isStaff = touchPanelState.mode === 'staff';
            const basePrice = typeof product.price === 'number' ? product.price : 0;

            const { total: priceEach } = tpComputeSelectionsSummary(basePrice, questions, draft.selections);
            const total = priceEach * draft.qty;
            const reco = isRecommendedJan(product.jan);

            const variationHtml = questions.map((q, qIdx) => {
                if (!q.options || q.options.length === 0) return '';
                const sectionLabel = q.label ? `${q.label}を選んでください` : 'サイズ・種類を選んでください';
                const multiNote = q.multi ? '<small style="opacity:.7;">（複数選択可）</small>' : '';
                const selectedSet = draft.selections[qIdx] || [];

                const chips = q.options.map(o => {
                    const p = tpComputeOptionPrice(basePrice, o);
                    const diffHtml = tpFormatPriceDiff(p - basePrice);
                    const active = selectedSet.includes(o.label);
                    return `<button class="tp-chip ${active ? 'active' : ''}" onclick="selectTouchPanelModalVariantOption(${qIdx}, '${tpAttr(o.label)}')">${tpEsc(o.label)}${diffHtml ? `<small>（${diffHtml}）</small>` : ''}</button>`;
                }).join('');

                return `
        <div class="tp-modal-section-label">${tpEsc(sectionLabel)}${multiNote}</div>
        <div class="tp-modal-variations">
            ${chips}
        </div>
    `;
            }).join('');

            const staffHtml = isStaff ? `
        <div class="tp-modal-staff-box">
            <div class="tp-modal-section-label" style="margin-top:0;">🧑‍💼 店員用設定</div>
            <div class="tp-modal-staff-actions">
                <button class="tp-btn tp-cancel" onclick="setTouchPanelProductImgPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🖼️ 写真を設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelProductImgUrlPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🔗 URLで設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelDescPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">📝 説明文を設定</button>
                <button class="tp-btn tp-cancel" onclick="setTouchPanelVariationsPrompt('${tpAttr(product.jan)}', '${tpAttr(product.name || '')}')">🔀 バリエーション設定（タッチパネル専用・価格差額無し・単一選択のみ）</button>
                <button class="tp-btn ${reco ? 'tp-reco-on' : 'tp-cancel'}" onclick="toggleRecommendedJan('${tpAttr(product.jan)}')">⭐ ${reco ? 'おすすめ解除' : 'おすすめに追加'}</button>
            </div>
            <div style="font-size:11px; color:#888; margin-top:6px;">※ 価格差額・複数選択・複数の質問は、商品管理画面の「🎨 バリエーション設定」で設定してください。</div>
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
   confirmAddTouchPanelModalItem() を上書きし、draft.selections
   （構造化された選択内容）をそのまま addItemToTouchPanelOrder() に
   渡すようにする（元の実装は draft.variation という単一の文字列を
   前提にしていたため、複数質問・複数選択の内容を渡せなかった）。
   ========================================================= */
(function overrideConfirmAddTouchPanelModalItemForVariantSync() {
    function tryHook() {
        if (typeof window.confirmAddTouchPanelModalItem !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.confirmAddTouchPanelModalItem = function () {
            const draft = touchPanelState.modalDraft;
            if (!draft) return;
            const productList = getProductListForTouchPanel();
            const product = productList.find(p => String(p.jan) === String(draft.jan));
            if (!product) return;

            addItemToTouchPanelOrder(product, draft.selections, draft.qty);
            if (typeof closeTouchPanelItemModal === 'function') closeTouchPanelItemModal();
        };
    }
    tryHook();
})();

/* =========================================================
   addItemToTouchPanelOrder() を上書きし、選択された質問・選択肢すべての
   差額を合計した金額をカートに使う。カート内の1件（item）としては、
   これまで通り variation を「文字列（または null）」として保持する
   （既存の注文一覧・レシート表示などを変更せずに済ませるため。複数の
   　選択肢が選ばれている場合は「・」で連結する）。
   ========================================================= */
(function overrideAddItemToTouchPanelOrderForVariantSync() {
    function tryHook() {
        if (typeof window.addItemToTouchPanelOrder !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        window.addItemToTouchPanelOrder = function (product, selections, qty) {
            qty = qty || 1;
            const variantInfo = getTouchPanelVariantOptionsWithPrice(product.jan);
            const questions = variantInfo ? variantInfo.questions : [];
            const basePrice = typeof product.price === 'number' ? product.price : 0;
            const sel = Array.isArray(selections) ? selections : [];

            const { labels, total } = tpComputeSelectionsSummary(basePrice, questions, sel);
            const priceEach = total;
            const variationLabel = labels.length > 0 ? labels.join('・') : null;

            const existing = touchPanelState.order.find(i => i.jan === product.jan && i.variation === variationLabel);
            if (existing) {
                existing.qty += qty;
            } else {
                touchPanelState.order.push({
                    jan: product.jan,
                    name: product.name,
                    price: priceEach,
                    variation: variationLabel,
                    qty: qty
                });
            }
            renderTouchPanelOrderList();
        };
    }
    tryHook();
})();
