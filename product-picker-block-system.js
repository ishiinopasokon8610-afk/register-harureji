// ==========================================
// product-picker-block-system.js
// ------------------------------------------
// 【背景】
// 自動化バーコード作成画面（新規作成／編集モーダルどちらも）の
// 「自動追加する商品」で使っている <select id="new-disc-product-select">
// / <select id="edit-disc-product-select"> は、商品数が増えるほど
// 普通のプルダウンでは目的の商品を探しにくくなる。
//
// 【この機能】
// 文字入力で検索する方式ではなく、「商品一覧」ボタンを押すと、
// 登録されている商品がブロック（カード）状に並んだ一覧が開き、
// タップ／クリックするだけで選べるようにする。
// 元の <select> 自体は画面上には出さず（display:none）そのまま残し、
// 選択結果を select.value に反映させることで、addStagedProductRow('new'|'edit')
// など既存のロジック（discount-system.js / index.htmlのonclick）が
// select.value を読む前提のまま、一切変更せずに動作し続けるようにする。
//
// discount-system.js / index.html は直接編集せず、
// 既存の <select> をDOM上でラップするだけの「フック/DOM注入方式」で実現する。
// ==========================================

let productPickerActiveSelectEl = null; // 現在ブロック一覧で選択操作をしている対象のselect

function enhanceProductPickerSelect(selectEl) {
    if (!selectEl || selectEl.dataset.pickerEnhanced === '1') return;
    selectEl.dataset.pickerEnhanced = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'product-picker-wrapper';
    wrapper.style.cssText = 'display:flex; gap:6px; align-items:center; flex:1; min-width:220px;';

    // 選択中の商品名を表示するだけの表示欄（編集不可・クリックでも一覧が開く）
    const display = document.createElement('input');
    display.type = 'text';
    display.readOnly = true;
    display.className = selectEl.className + ' product-picker-display';
    display.placeholder = '（未選択）';
    display.style.cssText = 'flex:1; background:#f7f7f7; cursor:pointer;';

    const listBtn = document.createElement('button');
    listBtn.type = 'button';
    listBtn.className = 'discount-add-btn';
    listBtn.innerText = '📦 商品一覧';
    listBtn.style.whiteSpace = 'nowrap';

    const openList = () => openProductBlockList(selectEl, display);
    display.addEventListener('click', openList);
    listBtn.addEventListener('click', openList);

    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(display);
    wrapper.appendChild(listBtn);
    wrapper.appendChild(selectEl);
    selectEl.style.display = 'none';

    function syncDisplayFromSelectValue() {
        const opt = selectEl.options[selectEl.selectedIndex];
        display.value = (opt && opt.value) ? opt.textContent : '';
    }
    syncDisplayFromSelectValue();

    wrapper._syncFromSelect = syncDisplayFromSelectValue;
}

/* =========================================================
   ブロック表示の商品一覧モーダル（1つを使い回す）
   ========================================================= */
function ensureProductBlockModal() {
    let modal = document.getElementById('product-block-picker-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'product-block-picker-modal';
    modal.style.cssText = [
        'display:none', 'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.5)',
        'z-index:9000', 'align-items:center', 'justify-content:center'
    ].join(';');

    modal.innerHTML = `
        <div style="background:#fff; width:min(720px, 92vw); max-height:80vh; border-radius:10px; padding:16px; display:flex; flex-direction:column;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:10px;">
                <h3 style="margin:0; white-space:nowrap;">📦 商品一覧から選択</h3>
                <input type="text" id="product-block-picker-search" placeholder="商品名で検索..." autocomplete="off"
                    style="flex:1; min-width:0; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:14px; box-sizing:border-box;">
                <button type="button" id="product-block-picker-close" style="padding:6px 14px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap;">閉じる ✕</button>
            </div>
            <div id="product-block-picker-body" style="overflow-y:auto; flex:1; padding-right:4px;"></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#product-block-picker-close').addEventListener('click', closeProductBlockList);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeProductBlockList(); // 背景クリックでも閉じる
    });

    // 商品名検索：既にブロック表示されているカードをジャンル見出しごと絞り込む
    // （一覧の再取得・再描画はせず、表示/非表示の切り替えのみで軽量に行う）
    modal.querySelector('#product-block-picker-search').addEventListener('input', (e) => {
        filterProductBlockCards(e.target.value);
    });

    return modal;
}

// 検索欄の入力に応じて、ジャンルセクション単位でカードを絞り込む
function filterProductBlockCards(query) {
    const body = document.getElementById('product-block-picker-body');
    if (!body) return;
    const q = (query || '').trim().toLowerCase();

    let anyVisibleTotal = false;
    body.querySelectorAll('.product-picker-genre-section').forEach(section => {
        let anyVisibleInSection = false;
        section.querySelectorAll('button').forEach(card => {
            const match = !q || card.innerText.toLowerCase().includes(q);
            card.style.display = match ? '' : 'none';
            if (match) anyVisibleInSection = true;
        });
        section.style.display = anyVisibleInSection ? '' : 'none';
        if (anyVisibleInSection) anyVisibleTotal = true;
    });

    let noMatch = body.querySelector('#product-block-picker-no-match');
    if (q && !anyVisibleTotal) {
        if (!noMatch) {
            noMatch = document.createElement('p');
            noMatch.id = 'product-block-picker-no-match';
            noMatch.style.cssText = 'color:#999; text-align:center; padding:20px;';
            noMatch.innerText = '該当する商品が見つかりません';
            body.appendChild(noMatch);
        }
        noMatch.style.display = '';
    } else if (noMatch) {
        noMatch.style.display = 'none';
    }
}

function closeProductBlockList() {
    const modal = document.getElementById('product-block-picker-modal');
    if (modal) modal.style.display = 'none';
    productPickerActiveSelectEl = null;
}

// 商品ブロックをタップして追加した直後、モーダルを閉じない代わりに
// 「選ばれた（追加された）」ことが視覚的に分かるよう、一瞬だけカードの色を変える
function flashPickedProductCard(card) {
    if (!card) return;
    const originalBg = card.style.background;
    const originalBorder = card.style.borderColor;
    card.style.background = '#c8e6c9';
    card.style.borderColor = '#43a047';
    setTimeout(() => {
        card.style.background = originalBg || '#fafafa';
        card.style.borderColor = originalBorder || '#ddd';
    }, 350);
}

function openProductBlockList(selectEl, displayInput) {
    productPickerActiveSelectEl = { selectEl, displayInput };
    const modal = ensureProductBlockModal();
    const body = modal.querySelector('#product-block-picker-body');
    body.innerHTML = '';

    // 前回開いた時の検索文字が残らないよう、開くたびに検索欄をリセットする
    const searchInput = modal.querySelector('#product-block-picker-search');
    if (searchInput) searchInput.value = '';

    const options = Array.from(selectEl.options).filter(o => o.value !== '');

    if (options.length === 0) {
        body.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">選択できる商品がありません。先に商品管理から商品を登録してください。</p>';
    } else {
        // ジャンルごとに見出しを付けて、ジャンル→商品名の順にブロックを並べる
        // （検索欄ではなく、見出しで探しやすくする「ブロック表示」）
        const productList = (typeof getProductListSafe === 'function') ? getProductListSafe() : [];
        const janToGenre = {};
        productList.forEach(p => { if (p.jan) janToGenre[p.jan] = p.genre || 'その他商品'; });

        const grouped = {};
        options.forEach(o => {
            const genre = janToGenre[o.value] || 'その他商品';
            if (!grouped[genre]) grouped[genre] = [];
            grouped[genre].push(o);
        });

        Object.keys(grouped).sort().forEach(genre => {
            const section = document.createElement('div');
            section.className = 'product-picker-genre-section';

            const heading = document.createElement('div');
            heading.style.cssText = 'font-weight:bold; color:#555; margin:12px 0 6px; font-size:13px;';
            heading.innerText = genre;
            section.appendChild(heading);

            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:10px;';

            grouped[genre].forEach(o => {
                const card = document.createElement('button');
                card.type = 'button';
                card.innerText = o.textContent;
                card.style.cssText = [
                    'padding:14px 10px', 'border:2px solid #ddd', 'border-radius:10px', 'background:#fafafa',
                    'cursor:pointer', 'font-size:14px', 'font-weight:bold', 'text-align:center',
                    'transition:background 120ms, border-color 120ms'
                ].join(';');
                card.addEventListener('mouseenter', () => { card.style.background = '#e8f0fe'; card.style.borderColor = '#4285f4'; });
                card.addEventListener('mouseleave', () => { card.style.background = '#fafafa'; card.style.borderColor = '#ddd'; });
                card.addEventListener('click', () => {
                    selectEl.value = o.value;
                    displayInput.value = o.textContent;
                    selectEl.dispatchEvent(new Event('change'));

                    // 【不具合修正】商品ブロックをタップした時点で「＋この商品を追加」を
                    // 押したのと同じ状態にする（＋ボタンを別途押さなくても仮組みリストに
                    // 追加されるようにする）。数量は既存の「＋」ボタンと同じく、
                    // 数量入力欄（new-disc-product-qty / edit-disc-product-qty）の値
                    // （未入力時は1）がそのまま使われる。
                    const prefix = (selectEl.id === 'edit-disc-product-select') ? 'edit' : 'new';
                    if (typeof addStagedProductRow === 'function') {
                        addStagedProductRow(prefix);
                    } else if (typeof playSound === 'function') {
                        playSound('click');
                    }

                    // 【変更】以前はここで一覧を閉じていたが、複数の商品を続けて
                    // 選びたい場合に毎回開き直すのが手間なため、選んでも画面（モーダル）は
                    // 閉じないようにする。閉じるのは「閉じる ✕」ボタン／背景クリックのみ。
                    // 代わりに、選んだことが分かるよう一瞬だけカードを光らせるフィードバックを入れる。
                    flashPickedProductCard(card);
                });
                grid.appendChild(card);
            });

            section.appendChild(grid);
            body.appendChild(section);
        });
    }

    modal.style.display = 'flex';
}

// 「＋この商品を追加」ボタンが押された後、元のselectが自動でリセットされる
// 実装になっている場合に備え、押下後に表示欄も一緒にリセットする
document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.discount-add-btn');
    if (!btn || btn.innerText.indexOf('商品一覧') !== -1) return; // 一覧を開くボタン自身は対象外
    setTimeout(() => {
        document.querySelectorAll('.product-picker-wrapper').forEach(w => {
            if (typeof w._syncFromSelect === 'function') w._syncFromSelect();
        });
    }, 0);
});

function enhanceAllProductPickerSelects() {
    document.querySelectorAll('#new-disc-product-select, #edit-disc-product-select').forEach(enhanceProductPickerSelect);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceAllProductPickerSelects);
} else {
    enhanceAllProductPickerSelects();
}
