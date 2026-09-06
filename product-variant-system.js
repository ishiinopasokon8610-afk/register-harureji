// ==========================================
// product-variant-system.js
// ------------------------------------------
// 【背景】
// 同人誌即売会やアパレル系ポップアップストアなどでは、
// 「同じ商品（同じ価格帯）だが、サイズ（S/M/L）やキャラ（A/B/C）などの
// バリエーションが複数ある」商品を扱うことが多い。
// これらを別々の商品として商品管理に登録すると、商品一覧・レジのボタンが
// 埋まってしまい、レジ担当者が探しにくくなる。
//
// 【この機能】
// 商品本体（pos_products）のデータ構造・保存ロジック（master-mgmt.js等、
// 商品追加/編集の実体）には一切手を加えず、バリエーション情報を
// 完全に別の保存領域（pos_product_variants、JANコードをキーにした
// オブジェクト）として管理する。
//   pos_product_variants = {
//     "<JANコード>": {
//       groupLabel: "サイズ",   // 任意のラベル（例：サイズ／キャラ／色）
//       options: [
//         { label: "S", price: null },   // priceがnull/空なら商品本体の価格を使う
//         { label: "M", price: null },
//         { label: "L", price: 1100 }    // 個別に価格を上書きすることも可能
//       ]
//     }
//   }
//
// 【レジ画面での挙動】
// generateCustomButtons()（register.js）をフックし、描画された商品ボタンの
// うち「バリエーション設定済み」の商品には🎨バッジを付け、クリック時の
// 挙動を「バリエーション選択ポップアップを開く」ように上書きする。
// 選択すると、選ばれた選択肢の名前を商品名に合成した「仮の商品オブジェクト」
// （例: 名前="Tシャツ（Mサイズ）"）を作り、既存の checkAndAddToCart() に
// そのまま渡す（年齢確認・詐欺注意などの既存ロジックをそのまま活かすため）。
// 商品名にバリエーションが含まれる状態でカートに入るため、
// 既存のレシート・履歴・XLSX出力・税区分集計は無改修のまま
// 「Tシャツ（Mサイズ）」単位の内訳として残る。
//
// 【商品管理画面での挙動】
// product-screenのtop-barに「🎨 バリエーション設定」ボタンを追加する
// （product-export-system.jsのボタン自動注入と同じ方式）。
// 押すと、登録済み商品をブロック一覧から選び、グループ名と選択肢
// （ラベル・任意の価格上書き）を設定できるモーダルが開く。
//
// register.js / ui.js / master-mgmt.js / index.html は直接編集せず、
// 他の追加機能ファイルと同じ「フック/DOM注入方式」で実現する。
// ==========================================

const PRODUCT_VARIANTS_KEY = 'pos_product_variants';

/* =========================================================
   データ層
   ========================================================= */
function getAllProductVariants() {
    try {
        return JSON.parse(localStorage.getItem(PRODUCT_VARIANTS_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function getProductVariants(jan) {
    if (!jan) return null;
    const all = getAllProductVariants();
    return all[jan] || null;
}

// options が空になった場合は設定自体を削除する（「設定済み」バッジの誤表示を防ぐため）
function saveProductVariantsFor(jan, config) {
    if (!jan) return;
    const all = getAllProductVariants();
    if (!config || !Array.isArray(config.options) || config.options.length === 0) {
        delete all[jan];
    } else {
        all[jan] = {
            groupLabel: (config.groupLabel || '').trim(),
            options: config.options.map(o => ({
                label: (o.label || '').trim(),
                price: (o.price === '' || o.price === null || o.price === undefined) ? null : Number(o.price)
            })).filter(o => o.label !== '')
        };
        if (all[jan].options.length === 0) delete all[jan];
    }
    localStorage.setItem(PRODUCT_VARIANTS_KEY, JSON.stringify(all));
}

function getProductListForVariantsSafe() {
    // product-export-system.js が読み込まれていればそちらの実装を再利用する
    if (typeof getProductListSafe === 'function') return getProductListSafe();
    try {
        if (typeof products !== 'undefined' && Array.isArray(products)) return products;
        return JSON.parse(localStorage.getItem('pos_products') || '[]');
    } catch (e) {
        return [];
    }
}

/* =========================================================
   レジ画面：商品ボタンへのバリエーション対応注入
   ========================================================= */

// generateCustomButtons() 内部と全く同じ絞り込み・並び替えロジックを再現し、
// 描画された各ボタンがどの商品に対応するかを特定する
// （ボタン側にJAN等の付与が無いため、同じ順序を再計算して突き合わせる）。
function computeFilteredSortedProductsForButtonsSafe() {
    if (typeof products === 'undefined' || !Array.isArray(products)) return [];

    const genreFilter = (typeof selectedGenreFilter !== 'undefined') ? selectedGenreFilter : 'すべて';
    let filtered = products;
    if (genreFilter !== 'すべて') {
        filtered = filtered.filter(p => (p.genre || 'その他商品') === genreFilter);
    }

    const searchInput = document.getElementById('product-name-search');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
        filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(searchTerm));
    }

    return filtered.slice().sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
}

function applyVariantButtonOverrides() {
    const area = document.getElementById('custom-buttons-area');
    if (!area) return;

    const buttons = Array.from(area.children).filter(el => el.tagName === 'BUTTON');
    const orderedProducts = computeFilteredSortedProductsForButtonsSafe();

    // 想定外の構成（表示件数の不一致）の場合は、誤った商品に上書きしてしまう
    // リスクを避けるため、安全側に倒して何もしない
    if (buttons.length !== orderedProducts.length) return;

    buttons.forEach((btn, idx) => {
        const prod = orderedProducts[idx];
        const variantConfig = getProductVariants(prod.jan);
        if (!variantConfig || !variantConfig.options || variantConfig.options.length === 0) return;

        if (!btn.querySelector('.prod-variant-badge')) {
            const badge = document.createElement('span');
            badge.className = 'prod-variant-badge';
            badge.style.cssText = 'position:absolute; top:2px; right:2px; background:#7c4dff; color:#fff; font-size:9px; padding:1px 5px; border-radius:8px; font-weight:bold;';
            badge.innerText = '🎨選択';
            btn.appendChild(badge);
        }

        // 元のonclick（checkAndAddToCartを直接呼ぶ挙動）を、バリエーション選択
        // ポップアップを開く挙動に上書きする
        btn.onclick = () => {
            if (typeof playSound === 'function') playSound('click');
            openVariantPickerModal(prod, variantConfig);
        };
    });
}

(function hookGenerateCustomButtonsForVariants() {
    function tryHook() {
        if (typeof window.generateCustomButtons !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateCustomButtons;
        window.generateCustomButtons = function (...args) {
            const result = original.apply(this, args);
            applyVariantButtonOverrides();
            return result;
        };
    }
    tryHook();
})();

/* ---------- バリエーション選択ポップアップ（レジ担当者用） ---------- */
function ensureVariantPickerModal() {
    let modal = document.getElementById('variant-picker-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'variant-picker-modal';
    modal.style.cssText = [
        'display:none', 'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.5)',
        'z-index:9500', 'align-items:center', 'justify-content:center'
    ].join(';');

    modal.innerHTML = `
        <div style="background:#fff; width:min(480px, 92vw); max-height:80vh; border-radius:10px; padding:18px; display:flex; flex-direction:column;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; gap:10px;">
                <h3 id="variant-picker-title" style="margin:0; font-size:16px;">🎨 バリエーションを選択</h3>
                <button type="button" id="variant-picker-close" style="padding:6px 14px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap;">閉じる ✕</button>
            </div>
            <div id="variant-picker-body" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px; overflow-y:auto;"></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#variant-picker-close').addEventListener('click', closeVariantPickerModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeVariantPickerModal(); });

    return modal;
}

function closeVariantPickerModal() {
    const modal = document.getElementById('variant-picker-modal');
    if (modal) modal.style.display = 'none';
    if (typeof focusJanInput === 'function') focusJanInput();
}

function openVariantPickerModal(prod, variantConfig) {
    const modal = ensureVariantPickerModal();
    const title = modal.querySelector('#variant-picker-title');
    const body = modal.querySelector('#variant-picker-body');
    const safeName = (typeof escapeHtml === 'function') ? escapeHtml(prod.name) : prod.name;
    const safeGroupLabel = (typeof escapeHtml === 'function') ? escapeHtml(variantConfig.groupLabel || '') : (variantConfig.groupLabel || '');

    title.innerHTML = `🎨 ${safeName}<br><small style="font-weight:normal;">${safeGroupLabel || 'バリエーション'}を選んでください</small>`;
    body.innerHTML = '';

    variantConfig.options.forEach(opt => {
        const price = (opt.price !== null && opt.price !== undefined) ? Number(opt.price) : prod.price;
        const safeLabel = (typeof escapeHtml === 'function') ? escapeHtml(opt.label) : opt.label;

        const card = document.createElement('button');
        card.type = 'button';
        card.style.cssText = [
            'padding:16px 8px', 'border:2px solid #ddd', 'border-radius:10px', 'background:#fafafa',
            'cursor:pointer', 'font-size:14px', 'font-weight:bold', 'text-align:center',
            'transition:background 120ms, border-color 120ms'
        ].join(';');
        card.innerHTML = `${safeLabel}<br><small style="font-weight:normal; color:#666;">¥${price.toLocaleString()}</small>`;
        card.addEventListener('mouseenter', () => { card.style.background = '#ede7f6'; card.style.borderColor = '#7c4dff'; });
        card.addEventListener('mouseleave', () => { card.style.background = '#fafafa'; card.style.borderColor = '#ddd'; });

        card.addEventListener('click', () => {
            const virtualProd = Object.assign({}, prod, {
                name: `${prod.name}（${opt.label}）`,
                price: price
            });
            closeVariantPickerModal();
            if (typeof checkAndAddToCart === 'function') checkAndAddToCart(virtualProd);
        });

        body.appendChild(card);
    });

    modal.style.display = 'flex';
}

/* =========================================================
   商品管理画面：バリエーション設定UI（管理者用）
   ========================================================= */
function ensureProductVariantAdminButton() {
    if (document.getElementById('product-variant-admin-btn')) return;
    const topBar = document.querySelector('#product-screen .top-bar');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'product-variant-admin-btn';
    btn.className = 'csv-export-btn';
    btn.innerText = '🎨 バリエーション設定';
    btn.style.marginLeft = document.getElementById('product-export-btn') ? '8px' : 'auto';
    btn.onclick = openProductVariantAdminModal;

    topBar.appendChild(btn);
}

(function hookShowScreenForVariantAdminButton() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'product-screen') ensureProductVariantAdminButton();
            return result;
        };
    }
    tryHook();
})();

function ensureProductVariantAdminModal() {
    let modal = document.getElementById('product-variant-admin-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'product-variant-admin-modal';
    modal.style.cssText = [
        'display:none', 'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.5)',
        'z-index:9000', 'align-items:center', 'justify-content:center'
    ].join(';');

    modal.innerHTML = `
        <div style="background:#fff; width:min(720px, 92vw); max-height:85vh; border-radius:10px; padding:16px; display:flex; flex-direction:column;">
            <div id="pv-admin-list-view">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:10px;">
                    <h3 style="margin:0; white-space:nowrap;">🎨 バリエーション設定：商品を選択</h3>
                    <input type="text" id="pv-admin-search" placeholder="商品名で検索..." autocomplete="off"
                        style="flex:1; min-width:0; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:14px; box-sizing:border-box;">
                    <button type="button" id="pv-admin-close" style="padding:6px 14px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap;">閉じる ✕</button>
                </div>
                <div id="pv-admin-list-body" style="overflow-y:auto; max-height:65vh; padding-right:4px;"></div>
            </div>

            <div id="pv-admin-editor-view" style="display:none;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:10px;">
                    <button type="button" id="pv-admin-back" style="padding:6px 14px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap;">← 商品一覧に戻る</button>
                    <h3 id="pv-admin-editor-title" style="margin:0; flex:1; text-align:right;"></h3>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-weight:bold; display:block; margin-bottom:4px;">グループ名（例：サイズ／キャラ／色）</label>
                    <input type="text" id="pv-admin-group-label" placeholder="例: サイズ" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:6px;">
                </div>
                <div id="pv-admin-options-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px; overflow-y:auto; max-height:40vh;"></div>
                <button type="button" id="pv-admin-add-option" style="align-self:flex-start; padding:6px 12px; border:1px dashed #7c4dff; color:#7c4dff; background:#fff; border-radius:6px; cursor:pointer; margin-bottom:14px;">＋ 選択肢を追加</button>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button type="button" id="pv-admin-delete" style="padding:8px 16px; border:1px solid #e53935; color:#e53935; background:#fff; border-radius:6px; cursor:pointer;">バリエーションを削除</button>
                    <button type="button" id="pv-admin-save" style="padding:8px 20px; border:none; color:#fff; background:#7c4dff; border-radius:6px; cursor:pointer; font-weight:bold;">保存</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#pv-admin-close').addEventListener('click', closeProductVariantAdminModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeProductVariantAdminModal(); });
    modal.querySelector('#pv-admin-search').addEventListener('input', (e) => renderProductVariantAdminList(e.target.value));
    modal.querySelector('#pv-admin-back').addEventListener('click', showProductVariantAdminListView);
    modal.querySelector('#pv-admin-add-option').addEventListener('click', () => addProductVariantOptionRow());
    modal.querySelector('#pv-admin-save').addEventListener('click', saveProductVariantAdminEditor);
    modal.querySelector('#pv-admin-delete').addEventListener('click', deleteProductVariantAdminEditor);

    return modal;
}

function closeProductVariantAdminModal() {
    const modal = document.getElementById('product-variant-admin-modal');
    if (modal) modal.style.display = 'none';
}

function openProductVariantAdminModal() {
    if (typeof playSound === 'function') playSound('click');
    ensureProductVariantAdminModal();
    showProductVariantAdminListView();
    const modal = document.getElementById('product-variant-admin-modal');
    modal.style.display = 'flex';
}

function showProductVariantAdminListView() {
    document.getElementById('pv-admin-list-view').style.display = 'block';
    document.getElementById('pv-admin-editor-view').style.display = 'none';
    const search = document.getElementById('pv-admin-search');
    if (search) search.value = '';
    renderProductVariantAdminList('');
}

function renderProductVariantAdminList(query) {
    const body = document.getElementById('pv-admin-list-body');
    if (!body) return;
    body.innerHTML = '';

    const q = (query || '').trim().toLowerCase();
    const productList = getProductListForVariantsSafe();
    const filtered = !q ? productList : productList.filter(p => (p.name || '').toLowerCase().includes(q));

    if (filtered.length === 0) {
        body.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">該当する商品が見つかりません。</p>';
        return;
    }

    const grouped = {};
    filtered.forEach(p => {
        const genre = p.genre || 'その他商品';
        if (!grouped[genre]) grouped[genre] = [];
        grouped[genre].push(p);
    });

    Object.keys(grouped).sort().forEach(genre => {
        const section = document.createElement('div');
        section.style.marginBottom = '14px';

        const heading = document.createElement('div');
        heading.style.cssText = 'font-weight:bold; color:#555; margin:6px 0; font-size:13px;';
        heading.innerText = genre;
        section.appendChild(heading);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px;';

        grouped[genre].forEach(p => {
            const hasVariants = !!getProductVariants(p.jan);
            const card = document.createElement('button');
            card.type = 'button';
            card.style.cssText = [
                'padding:12px 10px', 'border:2px solid', hasVariants ? 'border-color:#7c4dff;' : 'border-color:#ddd;',
                'border-radius:10px', hasVariants ? 'background:#f3f0ff;' : 'background:#fafafa;',
                'cursor:pointer', 'font-size:13px', 'font-weight:bold', 'text-align:center'
            ].join(';');
            const safeName = (typeof escapeHtml === 'function') ? escapeHtml(p.name) : p.name;
            card.innerHTML = `${safeName}${hasVariants ? '<br><small style="color:#7c4dff; font-weight:normal;">🎨設定済み</small>' : ''}`;
            card.addEventListener('click', () => openProductVariantEditor(p));
            grid.appendChild(card);
        });

        section.appendChild(grid);
        body.appendChild(section);
    });
}

let productVariantEditingJan = null;

function openProductVariantEditor(prod) {
    productVariantEditingJan = prod.jan;
    document.getElementById('pv-admin-list-view').style.display = 'none';
    document.getElementById('pv-admin-editor-view').style.display = 'block';

    const safeName = (typeof escapeHtml === 'function') ? escapeHtml(prod.name) : prod.name;
    document.getElementById('pv-admin-editor-title').innerText = `対象商品：${prod.name}`;

    const existing = getProductVariants(prod.jan);
    document.getElementById('pv-admin-group-label').value = existing ? (existing.groupLabel || '') : '';

    const list = document.getElementById('pv-admin-options-list');
    list.innerHTML = '';

    const initialOptions = (existing && existing.options && existing.options.length > 0)
        ? existing.options
        : [{ label: '', price: null }, { label: '', price: null }];

    initialOptions.forEach(opt => addProductVariantOptionRow(opt.label, opt.price));

    document.getElementById('pv-admin-delete').style.display = existing ? 'inline-block' : 'none';
}

function addProductVariantOptionRow(label = '', price = null) {
    const list = document.getElementById('pv-admin-options-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'pv-admin-option-row';
    row.style.cssText = 'display:flex; gap:8px; align-items:center;';
    row.innerHTML = `
        <input type="text" class="pv-opt-label" placeholder="選択肢名（例: M）" value="${(typeof escapeHtml === 'function') ? escapeHtml(label) : label}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <input type="number" class="pv-opt-price" placeholder="価格（空欄で基本価格）" value="${price !== null && price !== undefined ? price : ''}" style="width:170px; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <button type="button" class="pv-opt-remove" style="padding:8px 10px; border:1px solid #e53935; color:#e53935; background:#fff; border-radius:6px; cursor:pointer;">✕</button>
    `;
    row.querySelector('.pv-opt-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function saveProductVariantAdminEditor() {
    if (!productVariantEditingJan) return;

    const groupLabel = document.getElementById('pv-admin-group-label').value;
    const rows = Array.from(document.querySelectorAll('#pv-admin-options-list .pv-admin-option-row'));
    const options = rows.map(row => ({
        label: row.querySelector('.pv-opt-label').value,
        price: row.querySelector('.pv-opt-price').value
    })).filter(o => (o.label || '').trim() !== '');

    if (options.length === 0) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('選択肢を1つ以上入力してください。', 'せんたくし を ひとつ いじょう にゅうりょく し て ください。', () => {}, false);
        }
        return;
    }

    saveProductVariantsFor(productVariantEditingJan, { groupLabel, options });
    if (typeof playSound === 'function') playSound('success');
    showProductVariantAdminListView();
}

function deleteProductVariantAdminEditor() {
    if (!productVariantEditingJan) return;
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm('このバリエーション設定を削除しますか？', 'この ばりえーしょん せってい を さくじょ し ます か？', (res) => {
            if (!res) return;
            saveProductVariantsFor(productVariantEditingJan, null);
            if (typeof playSound === 'function') playSound('click');
            showProductVariantAdminListView();
        }, true);
    } else if (confirm('このバリエーション設定を削除しますか？')) {
        saveProductVariantsFor(productVariantEditingJan, null);
        showProductVariantAdminListView();
    }
}
