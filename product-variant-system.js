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
// 【今回の変更（大幅リニューアル）】
// これまでは「バリエーション＝選択肢1グループのみ・価格は絶対価格で
// 上書き」という仕組みだったが、以下の3点に対応するよう作り直した。
//   ① 質問を複数追加できるようにした（例：①サイズを選んでください
//      ②トッピングを選んでください、のように独立した質問をいくつでも
//      追加できる）。
//   ② 選択肢の価格入力を「絶対価格を直接入力」ではなく「基本価格に対して
//      ＋／－を選んで差額（円）を入力」する方式に変更した
//      （例：中盛＝＋50円、小盛＝－50円、普通＝差額なし）。
//   ③ 質問ごとに「複数選択できる（チェックボックス形式）」を設定できる
//      ようにした。複数選択した場合は、選ばれた選択肢すべての差額が
//      合計される。
//
// データ構造（pos_product_variants、JANコードをキーにしたオブジェクト）：
//   pos_product_variants = {
//     "<JANコード>": {
//       questions: [
//         {
//           label: "サイズ",     // 質問名
//           multi: false,        // true=複数選択（チェックボックス）
//           options: [
//             { label: "普通", sign: "+", amount: 0 },
//             { label: "中盛", sign: "+", amount: 50 },
//             { label: "小盛", sign: "-", amount: 50 }
//           ]
//         },
//         {
//           label: "トッピング",
//           multi: true,
//           options: [ { label: "チーズ", sign: "+", amount: 100 }, ... ]
//         }
//       ]
//     }
//   }
//
// 【旧データの互換性】
// 以前の形式 { groupLabel, options:[{label, price}] }（絶対価格・単一
// グループ）で保存済みのデータは、読み込み時（getProductVariants）に
// その場で新形式へ変換して扱う。保存データ自体は書き換えないので、
// このファイルを入れ替えただけで既存の設定が消えることはない
// （管理画面で開いて保存し直した時点で、新形式として上書き保存される）。
// 絶対価格が設定されていた選択肢は、価格計算時（computeVariantOptionPrice）
// にそのまま最優先で使われる。管理画面の編集欄を開いた時は、その時点の
// 商品の基本価格との差額に変換して＋／－表示するので、そのまま保存すれば
// 新形式（差額方式）に統一される。
//
// 【レジ画面での挙動】
// generateCustomButtons()（register.js）をフックし、描画された商品ボタンの
// うち「バリエーション設定済み」の商品には🎨バッジを付け、クリック時の
// 挙動を「バリエーション選択ポップアップを開く」ように上書きする。
// ポップアップでは、質問ごとに選択肢（単一選択＝1つだけ選べる／複数選択＝
// チェックボックス）を選び、合計金額を見ながら「🛒 カートに追加」を押すと、
// 選ばれた選択肢の名前をすべて商品名に合成した「仮の商品オブジェクト」
// （例: 名前="Tシャツ（Mサイズ・チーズ）"、価格＝基本価格＋選ばれた
// 差額の合計）を作り、既存の checkAndAddToCart() にそのまま渡す
// （年齢確認・詐欺注意などの既存ロジックをそのまま活かすため）。
// 商品名にバリエーションが含まれる状態でカートに入るため、
// 既存のレシート・履歴・XLSX出力・税区分集計は無改修のまま
// 「Tシャツ（Mサイズ・チーズ）」単位の内訳として残る。
//
// 【商品管理画面での挙動】
// product-screenのtop-barに「🎨 バリエーション設定」ボタンを追加する
// （product-export-system.jsのボタン自動注入と同じ方式）。
// 押すと、登録済み商品をブロック一覧から選び、質問（グループ）を
// 好きな数だけ追加し、それぞれに選択肢（ラベル・＋／－・差額）と
// 「複数選択できる」チェックボックスを設定できるモーダルが開く。
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

// 旧形式 { groupLabel, options:[{label, price}] } を
// 新形式 { questions:[{label, multi, options:[...]}] } に、その場で変換する。
// 保存データそのものは書き換えない（読み込み時の変換のみ）。
function normalizeVariantConfig(raw) {
    if (!raw) return null;

    if (Array.isArray(raw.questions)) {
        // すでに新形式
        return raw.questions.length > 0 ? raw : null;
    }

    // 旧形式（単一グループ・絶対価格）からの変換
    if (Array.isArray(raw.options) && raw.options.length > 0) {
        return {
            questions: [{
                label: raw.groupLabel || '',
                multi: false,
                options: raw.options.map(o => ({
                    label: o.label,
                    // 絶対価格（旧仕様）はそのまま保持し、価格計算時に最優先で使う
                    price: (o.price === null || o.price === undefined || o.price === '') ? null : Number(o.price),
                    sign: '+',
                    amount: 0
                }))
            }]
        };
    }

    return null;
}

function getProductVariants(jan) {
    if (!jan) return null;
    const all = getAllProductVariants();
    return normalizeVariantConfig(all[jan] || null);
}

// 選択肢1つぶんの最終価格を計算する。
// ・price（絶対価格。旧仕様からの互換用）が設定されていれば最優先で使う
// ・そうでなければ、基本価格に sign(+/-) と amount(差額・円) を適用する
function computeVariantOptionPrice(basePrice, opt) {
    const base = Number(basePrice) || 0;
    if (opt && opt.price !== null && opt.price !== undefined && opt.price !== '') {
        return Number(opt.price);
    }
    const amount = Number(opt && opt.amount) || 0;
    const sign = (opt && opt.sign === '-') ? -1 : 1;
    return base + sign * amount;
}

// 「＋¥50」「－¥50」のような差額表示文字列を作る（差額0なら空文字）
function formatVariantPriceDiff(diff) {
    if (!diff) return '';
    return diff > 0 ? `+¥${diff.toLocaleString()}` : `-¥${Math.abs(diff).toLocaleString()}`;
}

// options が空になった場合は設定自体を削除する（「設定済み」バッジの誤表示を防ぐため）
function saveProductVariantsFor(jan, config) {
    if (!jan) return;
    const all = getAllProductVariants();

    const cleanedQuestions = (config && Array.isArray(config.questions) ? config.questions : [])
        .map((q, idx) => ({
            // 質問名が空欄でも設定自体は保存できるよう、フォールバック名を付ける
            label: (q.label || '').trim() || `選択肢${idx + 1}`,
            multi: !!q.multi,
            options: (Array.isArray(q.options) ? q.options : [])
                .map(o => ({
                    label: (o.label || '').trim(),
                    sign: o.sign === '-' ? '-' : '+',
                    amount: Number(o.amount) || 0
                }))
                .filter(o => o.label !== '')
        }))
        .filter(q => q.options.length > 0);

    if (cleanedQuestions.length === 0) {
        delete all[jan];
    } else {
        all[jan] = { questions: cleanedQuestions };
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
   選択内容（questions配列 × 選択済みラベルの配列）から、
   合計価格・選ばれた選択肢名の一覧を計算する共通処理
   ========================================================= */
function computeVariantSelectionsSummary(basePrice, questions, selections) {
    const labels = [];
    let total = Number(basePrice) || 0;
    (questions || []).forEach((q, qIdx) => {
        (selections[qIdx] || []).forEach(label => {
            const opt = (q.options || []).find(o => o.label === label);
            if (!opt) return;
            labels.push(label);
            total += computeVariantOptionPrice(basePrice, opt) - (Number(basePrice) || 0);
        });
    });
    return { labels, total };
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
        if (!variantConfig || !variantConfig.questions || variantConfig.questions.length === 0) return;

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
// 開いている間の選択状態と対象商品・設定を、モーダルの外（このスコープ）で保持する。
// モーダル自体は一度だけ作り、確定ボタン等のイベントリスナーも一度だけ登録するため
// （毎回開くたびにリスナーを追加すると多重発火してしまう）、現在の対象は
// variantPickerContext を通じて参照する。
let variantPickerDraftSelections = [];
let variantPickerContext = null;

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
        <div style="background:#fff; width:min(520px, 92vw); max-height:85vh; border-radius:10px; padding:18px; display:flex; flex-direction:column;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; gap:10px;">
                <h3 id="variant-picker-title" style="margin:0; font-size:16px;">🎨 バリエーションを選択</h3>
                <button type="button" id="variant-picker-close" style="padding:6px 14px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap;">閉じる ✕</button>
            </div>
            <div id="variant-picker-body" style="overflow-y:auto; display:flex; flex-direction:column; gap:14px; flex:1;"></div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:14px; padding-top:12px; border-top:1px solid #eee;">
                <div id="variant-picker-total" style="font-size:15px; font-weight:bold;"></div>
                <button type="button" id="variant-picker-confirm" style="padding:10px 20px; border:none; color:#fff; background:#7c4dff; border-radius:8px; cursor:pointer; font-weight:bold;">🛒 カートに追加</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#variant-picker-close').addEventListener('click', closeVariantPickerModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeVariantPickerModal(); });

    modal.querySelector('#variant-picker-confirm').addEventListener('click', () => {
        if (!variantPickerContext) return;
        const { prod, variantConfig } = variantPickerContext;
        const { labels, total } = computeVariantSelectionsSummary(prod.price, variantConfig.questions, variantPickerDraftSelections);

        if (typeof playSound === 'function') playSound('click');
        const virtualProd = Object.assign({}, prod, {
            name: labels.length > 0 ? `${prod.name}（${labels.join('・')}）` : prod.name,
            price: total
        });
        closeVariantPickerModal();
        if (typeof checkAndAddToCart === 'function') checkAndAddToCart(virtualProd);
    });

    return modal;
}

function closeVariantPickerModal() {
    const modal = document.getElementById('variant-picker-modal');
    if (modal) modal.style.display = 'none';
    variantPickerContext = null;
    if (typeof focusJanInput === 'function') focusJanInput();
}

function renderVariantPickerBody() {
    const modal = document.getElementById('variant-picker-modal');
    if (!modal || !variantPickerContext) return;
    const { prod, variantConfig } = variantPickerContext;
    const body = modal.querySelector('#variant-picker-body');
    body.innerHTML = '';

    variantConfig.questions.forEach((q, qIdx) => {
        if (!q.options || q.options.length === 0) return;

        const section = document.createElement('div');
        const safeQLabel = (typeof escapeHtml === 'function') ? escapeHtml(q.label || 'バリエーション') : (q.label || 'バリエーション');
        const multiNote = q.multi ? '<small style="color:#888; font-weight:normal;">（複数選択可）</small>' : '';
        const heading = document.createElement('div');
        heading.style.cssText = 'font-weight:bold; margin-bottom:6px;';
        heading.innerHTML = `${safeQLabel}を選んでください${multiNote}`;
        section.appendChild(heading);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:8px;';

        const selectedSet = variantPickerDraftSelections[qIdx] || [];
        q.options.forEach(opt => {
            const price = computeVariantOptionPrice(prod.price, opt);
            const diff = price - (Number(prod.price) || 0);
            const diffLabel = formatVariantPriceDiff(diff);
            const selected = selectedSet.includes(opt.label);
            const safeLabel = (typeof escapeHtml === 'function') ? escapeHtml(opt.label) : opt.label;

            const card = document.createElement('button');
            card.type = 'button';
            card.style.cssText = [
                'padding:12px 6px', `border:2px solid ${selected ? '#7c4dff' : '#ddd'}`, 'border-radius:10px',
                `background:${selected ? '#ede7f6' : '#fafafa'}`, 'cursor:pointer', 'font-size:13px',
                'font-weight:bold', 'text-align:center', 'transition:background 120ms, border-color 120ms'
            ].join(';');
            card.innerHTML = `${safeLabel}${diffLabel ? `<br><small style="font-weight:normal; color:#666;">${diffLabel}</small>` : ''}`;

            card.addEventListener('click', () => {
                if (typeof playSound === 'function') playSound('click');
                if (q.multi) {
                    const cur = variantPickerDraftSelections[qIdx] || (variantPickerDraftSelections[qIdx] = []);
                    const pos = cur.indexOf(opt.label);
                    if (pos === -1) cur.push(opt.label); else cur.splice(pos, 1);
                } else {
                    variantPickerDraftSelections[qIdx] = [opt.label];
                }
                renderVariantPickerBody();
            });

            grid.appendChild(card);
        });

        section.appendChild(grid);
        body.appendChild(section);
    });

    const { total } = computeVariantSelectionsSummary(prod.price, variantConfig.questions, variantPickerDraftSelections);
    modal.querySelector('#variant-picker-total').innerText = `合計 ¥${total.toLocaleString()}`;
}

function openVariantPickerModal(prod, variantConfig) {
    const modal = ensureVariantPickerModal();
    variantPickerContext = { prod, variantConfig };

    // 単一選択の質問は先頭の選択肢を初期選択、複数選択の質問は未選択で開始する
    variantPickerDraftSelections = variantConfig.questions.map(q =>
        q.multi ? [] : (q.options && q.options[0] ? [q.options[0].label] : [])
    );

    const title = modal.querySelector('#variant-picker-title');
    const safeName = (typeof escapeHtml === 'function') ? escapeHtml(prod.name) : prod.name;
    title.innerHTML = `🎨 ${safeName}`;

    renderVariantPickerBody();
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
        <div style="background:#fff; width:min(760px, 94vw); max-height:88vh; border-radius:10px; padding:16px; display:flex; flex-direction:column;">
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
                <div style="font-size:12px; color:#888; margin-bottom:10px;">質問（サイズ・トッピングなど）をいくつでも追加できます。価格は基本価格からの差額（＋／－）で設定します。</div>
                <div id="pv-admin-questions-list" style="display:flex; flex-direction:column; gap:10px; margin-bottom:10px; overflow-y:auto; max-height:52vh; padding-right:4px;"></div>
                <button type="button" id="pv-admin-add-question" style="align-self:flex-start; padding:8px 14px; border:2px dashed #7c4dff; color:#7c4dff; background:#f8f6ff; border-radius:6px; cursor:pointer; margin-bottom:14px; font-weight:bold;">＋ 質問を追加（例：サイズ／トッピングなど）</button>
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
    modal.querySelector('#pv-admin-add-question').addEventListener('click', () => addProductVariantQuestionBlock(null));
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
// 編集画面を開いた時点の商品の基本価格。旧形式（絶対価格）の選択肢を
// ＋／－差額表示に変換するために使う。
let productVariantEditingBasePrice = 0;
let pvQuestionAutoId = 0;

function openProductVariantEditor(prod) {
    productVariantEditingJan = prod.jan;
    productVariantEditingBasePrice = Number(prod.price) || 0;
    document.getElementById('pv-admin-list-view').style.display = 'none';
    document.getElementById('pv-admin-editor-view').style.display = 'block';

    document.getElementById('pv-admin-editor-title').innerText = `対象商品：${prod.name}`;

    const existing = getProductVariants(prod.jan);

    const list = document.getElementById('pv-admin-questions-list');
    list.innerHTML = '';

    if (existing && existing.questions && existing.questions.length > 0) {
        existing.questions.forEach(q => addProductVariantQuestionBlock(q));
    } else {
        addProductVariantQuestionBlock(null);
    }

    document.getElementById('pv-admin-delete').style.display = existing ? 'inline-block' : 'none';
}

// 質問1つぶんのブロック（質問名・複数選択チェック・選択肢欄・質問削除ボタン）を作る。
// 戻り値のブロック要素を、bulk-add-system.js が「まとめて追加」ボタンの
// 差し込み先として使う（フック方式で拡張できるよう、必ず要素を返す）。
function addProductVariantQuestionBlock(question) {
    const container = document.getElementById('pv-admin-questions-list');
    if (!container) return null;

    const qid = 'pvq' + (++pvQuestionAutoId);
    const block = document.createElement('div');
    block.className = 'pv-admin-question-block';
    block.dataset.qid = qid;
    block.style.cssText = 'border:1px solid #e0dcf5; border-radius:10px; padding:12px; background:#faf9ff;';

    const safeLabel = (question && question.label) ? ((typeof escapeHtml === 'function') ? escapeHtml(question.label) : question.label) : '';
    const isMulti = !!(question && question.multi);

    block.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <input type="text" class="pv-q-label" placeholder="質問名（例：サイズを選んでください）" value="${safeLabel}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px; font-weight:bold;">
            <button type="button" class="pv-q-remove" title="この質問を削除" style="padding:6px 10px; border:1px solid #e53935; color:#e53935; background:#fff; border-radius:6px; cursor:pointer; white-space:nowrap;">この質問を削除 ✕</button>
        </div>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#555; margin-bottom:10px; cursor:pointer;">
            <input type="checkbox" class="pv-q-multi" ${isMulti ? 'checked' : ''}> 複数選択できるようにする（チェックボックス形式）
        </label>
        <div class="pv-q-options-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;"></div>
        <button type="button" class="pv-q-add-option" style="padding:6px 12px; border:1px dashed #7c4dff; color:#7c4dff; background:#fff; border-radius:6px; cursor:pointer;">＋ 選択肢を追加</button>
    `;

    block.querySelector('.pv-q-remove').addEventListener('click', () => block.remove());

    const optionsList = block.querySelector('.pv-q-options-list');
    block.querySelector('.pv-q-add-option').addEventListener('click', () => addProductVariantOptionRow(optionsList));

    container.appendChild(block);

    const initialOptions = (question && Array.isArray(question.options) && question.options.length > 0)
        ? question.options
        : [{ label: '', sign: '+', amount: 0 }, { label: '', sign: '+', amount: 0 }];

    initialOptions.forEach(opt => addProductVariantOptionRow(optionsList, opt));

    return block;
}

// 選択肢1行ぶんの入力欄（選択肢名・＋／－切替ボタン・差額入力・行削除ボタン）を作る。
// opt.price（旧仕様の絶対価格）が入っている場合は、その場で
// productVariantEditingBasePrice との差額に変換して表示する。
function addProductVariantOptionRow(optionsListEl, opt) {
    if (!optionsListEl) return;
    opt = opt || {};

    let sign = opt.sign === '-' ? '-' : '+';
    let amount = Number(opt.amount) || 0;
    if (opt.price !== null && opt.price !== undefined && opt.price !== '') {
        const diff = Number(opt.price) - (Number(productVariantEditingBasePrice) || 0);
        sign = diff < 0 ? '-' : '+';
        amount = Math.abs(diff);
    }

    const row = document.createElement('div');
    row.className = 'pv-admin-option-row';
    row.style.cssText = 'display:flex; gap:6px; align-items:center;';
    const safeLabel = (typeof escapeHtml === 'function') ? escapeHtml(opt.label || '') : (opt.label || '');
    row.innerHTML = `
        <input type="text" class="pv-opt-label" placeholder="選択肢名（例: 中盛）" value="${safeLabel}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <button type="button" class="pv-opt-sign" data-sign="${sign}" style="width:42px; padding:8px 0; border:none; color:#fff; background:${sign === '-' ? '#e53935' : '#43a047'}; border-radius:6px; cursor:pointer; font-weight:bold; font-size:16px;">${sign}</button>
        <input type="number" class="pv-opt-amount" min="0" placeholder="差額（円）" value="${amount || ''}" style="width:110px; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <button type="button" class="pv-opt-remove" style="padding:8px 10px; border:1px solid #e53935; color:#e53935; background:#fff; border-radius:6px; cursor:pointer;">✕</button>
    `;

    const signBtn = row.querySelector('.pv-opt-sign');
    signBtn.addEventListener('click', () => {
        const next = signBtn.dataset.sign === '-' ? '+' : '-';
        signBtn.dataset.sign = next;
        signBtn.innerText = next;
        signBtn.style.background = next === '-' ? '#e53935' : '#43a047';
    });
    row.querySelector('.pv-opt-remove').addEventListener('click', () => row.remove());

    optionsListEl.appendChild(row);
}

function saveProductVariantAdminEditor() {
    if (!productVariantEditingJan) return;

    const blocks = Array.from(document.querySelectorAll('#pv-admin-questions-list .pv-admin-question-block'));
    const questions = blocks.map(block => {
        const label = block.querySelector('.pv-q-label').value;
        const multi = block.querySelector('.pv-q-multi').checked;
        const rows = Array.from(block.querySelectorAll('.pv-q-options-list .pv-admin-option-row'));
        const options = rows.map(row => ({
            label: row.querySelector('.pv-opt-label').value,
            sign: row.querySelector('.pv-opt-sign').dataset.sign,
            amount: row.querySelector('.pv-opt-amount').value
        }));
        return { label, multi, options };
    });

    const hasAnyOption = questions.some(q => q.options.some(o => (o.label || '').trim() !== ''));
    if (!hasAnyOption) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('選択肢を1つ以上入力してください。', 'せんたくし を ひとつ いじょう にゅうりょく し て ください。', () => {}, false);
        }
        return;
    }

    saveProductVariantsFor(productVariantEditingJan, { questions });
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
