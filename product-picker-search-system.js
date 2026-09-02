// ==========================================
// product-picker-search-system.js
// ------------------------------------------
// 【背景】
// 自動化バーコード作成画面（新規作成／編集モーダルどちらも）の
// 「自動追加する商品」で使っている <select id="new-disc-product-select">
// / <select id="edit-disc-product-select"> は、商品数が増えるほど
// 普通のプルダウンでは目的の商品を探しにくくなる。
//
// 【この機能】
// 上記2つの <select> を、見た目はそのまま維持しつつ、
//   ・商品名の一部を入力して絞り込める検索欄
//   ・絞り込み結果をクリックで選択できる候補リスト
// に強化する。元の <select> 自体は画面上には出さず（display:none）
// そのまま残し、選択結果を select.value に反映させることで、
// addStagedProductRow('new'|'edit') など既存のロジック（discount-system.js /
// index.htmlのonclick）が select.value を読む前提のまま、一切変更せずに
// 動作し続けるようにする。
//
// discount-system.js / index.html は直接編集せず、
// 既存の <select> をDOM上でラップするだけの「フック/DOM注入方式」で実現する。
// ==========================================

function enhanceProductPickerSelect(selectEl) {
    if (!selectEl || selectEl.dataset.pickerEnhanced === '1') return;
    selectEl.dataset.pickerEnhanced = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'product-picker-wrapper';
    wrapper.style.cssText = 'position:relative; display:inline-block; flex:1; min-width:220px; vertical-align:middle;';

    const input = document.createElement('input');
    input.type = 'text';
    // 元のselectと同じクラスを付けることで、見た目（幅・枠線等）を既存CSSに合わせる
    input.className = selectEl.className + ' product-picker-input';
    input.placeholder = '商品名で検索...';
    input.autocomplete = 'off';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';

    const dropdown = document.createElement('div');
    dropdown.className = 'product-picker-dropdown';
    dropdown.style.cssText = [
        'position:absolute', 'top:100%', 'left:0', 'right:0', 'max-height:280px',
        'overflow-y:auto', 'background:#fff', 'border:1px solid #ccc', 'border-top:none',
        'border-radius:0 0 8px 8px', 'box-shadow:0 8px 20px rgba(0,0,0,0.18)',
        'z-index:5000', 'display:none'
    ].join(';');

    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    wrapper.appendChild(selectEl);
    selectEl.style.display = 'none';

    function getOptions() {
        return Array.from(selectEl.options).filter(o => o.value !== '');
    }

    function renderList(query) {
        const q = (query || '').trim().toLowerCase();
        const opts = getOptions();
        let filtered = !q ? opts : opts.filter(o => o.textContent.toLowerCase().includes(q));

        if (q) {
            // 前方一致（商品名の先頭に一致するもの）を優先的に上へ
            filtered.sort((a, b) => {
                const at = a.textContent.toLowerCase().startsWith(q) ? 0 : 1;
                const bt = b.textContent.toLowerCase().startsWith(q) ? 0 : 1;
                return at - bt;
            });
        }

        const LIMIT = 50;
        const limited = filtered.slice(0, LIMIT);

        dropdown.innerHTML = '';

        if (limited.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:12px; color:#999; font-size:13px; text-align:center;';
            empty.innerText = '該当する商品が見つかりません';
            dropdown.appendChild(empty);
            return;
        }

        limited.forEach(o => {
            const item = document.createElement('div');
            item.className = 'product-picker-item';
            item.style.cssText = 'padding:9px 12px; cursor:pointer; border-bottom:1px solid #f0f0f0; font-size:14px;';
            item.innerText = o.textContent;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // クリックでinputがblurして候補が消える前に処理する
                selectEl.value = o.value;
                input.value = o.textContent;
                closeDropdown();
                selectEl.dispatchEvent(new Event('change'));

                // 【追加】商品を選択した時点で、「＋この商品を追加」ボタンを別途押さなくても
                // 自動的に自動追加リストへ追加されるようにする。
                // select要素のidが「new-disc-product-select」/「edit-disc-product-select」
                // であることから prefix（'new'|'edit'）を割り出し、
                // 既存の addStagedProductRow(prefix) をそのまま呼び出す
                // （discount-system.js は直接編集せず、既存関数を呼ぶだけ）。
                const prefix = selectEl.id.startsWith('edit-') ? 'edit' : 'new';
                if (typeof addStagedProductRow === 'function') {
                    addStagedProductRow(prefix);
                }

                input.focus();
            });
            item.addEventListener('mouseenter', () => { item.style.background = '#f0f4ff'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; });
            dropdown.appendChild(item);
        });

        if (filtered.length > LIMIT) {
            const more = document.createElement('div');
            more.style.cssText = 'padding:6px 12px; color:#999; font-size:11px; text-align:center;';
            more.innerText = `他 ${filtered.length - LIMIT}件あります（さらに絞り込んでください）`;
            dropdown.appendChild(more);
        }
    }

    function openDropdown() {
        renderList(input.value);
        dropdown.style.display = 'block';
    }
    function closeDropdown() {
        dropdown.style.display = 'none';
    }

    input.addEventListener('focus', openDropdown);
    input.addEventListener('input', () => {
        renderList(input.value);
        dropdown.style.display = 'block';
    });
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) closeDropdown();
    });

    // 選択中の商品名を検索欄に反映する（「追加」ボタン押下後、元のselectが
    // 先頭(プレースホルダ)にリセットされた場合は検索欄も空に戻す）
    function syncInputFromSelectValue() {
        const opt = selectEl.options[selectEl.selectedIndex];
        input.value = (opt && opt.value) ? opt.textContent : '';
    }
    syncInputFromSelectValue();

    // discount-system.js が商品一覧の変更に合わせて<option>を作り直した時に追従する
    const observer = new MutationObserver(() => {
        if (dropdown.style.display === 'block') renderList(input.value);
    });
    observer.observe(selectEl, { childList: true });

    wrapper._syncFromSelect = syncInputFromSelectValue;
}

// 「＋この商品を追加」ボタンが押された後、元のselectが自動でリセットされる
// 実装になっている場合に備え、押下後に検索欄側の表示も一緒にリセットする
document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.discount-add-btn');
    if (!btn) return;
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
