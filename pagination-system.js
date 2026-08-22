// ==========================================
// pagination-system.js
// タイムカード／お会計履歴／担当者管理／商品管理の一覧を
// 10件ずつのページ表示にする
// ------------------------------------------
// 【方式】
// auth-system.js / master-mgmt.js は直接編集せず、既存の
// renderTimecardTable() / renderHistory() / renderClerks() / renderProducts()
// を安全に上書きラップする（他の追加機能ファイルと同じ「フック方式」）。
//
// これらの関数は呼ばれるたびに tbody の中身を一旦空にして全件分の<tr>を
// 作り直す仕組みになっているため、このファイルでは
//   1. まず元の関数を呼んで「全件分の<tr>」を通常通り作ってもらう
//   2. その中から実データの行（「該当データがありません」等のプレースホルダーは除く）
//      だけを取り出し、現在のページに対応する10件だけを表示、残りは display:none にする
//   3. テーブルの下に「« 前へ / 1 〜 3 ページ（全27件）/ 次へ »」のページ送りUIを出す
// という後処理を行う。
//
// 商品削除・編集ボタンなどの onclick="editSingleProduct(3)" のような
// 配列インデックスは、元のrender関数がそのまま全件分に対して振っているので、
// ページを送っても正しいインデックスを指し続ける（ズレない）。
// ==========================================

const PAGINATION_PAGE_SIZE = 10;

// 各画面の「今どのページを見ているか」
const paginationPageState = {
    'product-tbody': 1,
    'clerk-tbody': 1,
    'history-tbody': 1,
    'timecard-tbody': 1
};

// 画面ラベル（ページ送りUIの表示用）
const paginationLabels = {
    'product-tbody': '商品',
    'clerk-tbody': '担当者',
    'history-tbody': '履歴',
    'timecard-tbody': 'タイムカード'
};

// tbody内の<tr>のうち、「データが0件です」的なプレースホルダー行
// （colspan付きの<td>を持つ行）を除いた、実データの行だけを返す
function getPaginationDataRows(tbody) {
    return Array.from(tbody.children).filter(tr => !tr.querySelector('td[colspan]'));
}

function applyPaginationToTable(tbodyId, rerenderFnName) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    const dataRows = getPaginationDataRows(tbody);
    const pagerEl = getOrCreatePagerElement(tbodyId);

    if (dataRows.length === 0) {
        if (pagerEl) pagerEl.style.display = 'none';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(dataRows.length / PAGINATION_PAGE_SIZE));
    let page = paginationPageState[tbodyId] || 1;
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    paginationPageState[tbodyId] = page;

    const start = (page - 1) * PAGINATION_PAGE_SIZE;
    const end = start + PAGINATION_PAGE_SIZE;

    dataRows.forEach((tr, i) => {
        tr.style.display = (i >= start && i < end) ? '' : 'none';
    });

    renderPaginationControls(pagerEl, tbodyId, rerenderFnName, page, totalPages, dataRows.length);
}

// ページ送りUIを表示するための<div>を、テーブルの直後に用意する（既にあれば使い回す）
function getOrCreatePagerElement(tbodyId) {
    const existing = document.getElementById(`${tbodyId}-pager`);
    if (existing) return existing;

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return null;
    const table = tbody.closest('table');
    if (!table || !table.parentNode) return null;

    const pagerEl = document.createElement('div');
    pagerEl.id = `${tbodyId}-pager`;
    pagerEl.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:12px; padding:10px 0; font-size:13px;';
    table.insertAdjacentElement('afterend', pagerEl);
    return pagerEl;
}

function renderPaginationControls(pagerEl, tbodyId, rerenderFnName, page, totalPages, totalCount) {
    if (!pagerEl) return;
    pagerEl.style.display = totalPages > 1 ? 'flex' : 'none';
    if (totalPages <= 1) return; // 1ページに収まる場合はUI自体不要

    const label = paginationLabels[tbodyId] || '';
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= totalPages ? 'disabled' : '';

    pagerEl.innerHTML = `
        <button ${prevDisabled} style="padding:6px 14px; border-radius:4px; border:1px solid #ccc; background:${page <= 1 ? '#eee' : '#fff'}; cursor:${page <= 1 ? 'default' : 'pointer'};"
            onclick="goToPaginationPage('${tbodyId}', ${page - 1}, '${rerenderFnName}')">« 前へ</button>
        <span style="color:#333;">${label} ${page} / ${totalPages} ページ（全${totalCount}件）</span>
        <button ${nextDisabled} style="padding:6px 14px; border-radius:4px; border:1px solid #ccc; background:${page >= totalPages ? '#eee' : '#fff'}; cursor:${page >= totalPages ? 'default' : 'pointer'};"
            onclick="goToPaginationPage('${tbodyId}', ${page + 1}, '${rerenderFnName}')">次へ »</button>
    `;
}

function goToPaginationPage(tbodyId, newPage, rerenderFnName) {
    if (newPage < 1) return;
    paginationPageState[tbodyId] = newPage;
    if (typeof playSound === 'function') playSound('click');
    // 元のrender関数を呼び直す → 全<tr>が作り直され → このファイルのフックが
    // 新しいページ番号で改めてスライス表示する
    if (typeof window[rerenderFnName] === 'function') {
        window[rerenderFnName]();
    }
}

// データが更新されて件数が変わった時（商品追加・削除、履歴削除など）に、
// 表示中のページが存在しなくなっていないか調整したい場合はここで1ページ目に戻す
function resetPaginationPage(tbodyId) {
    paginationPageState[tbodyId] = 1;
}

/* =========================================================
   各render関数を安全に上書きラップする
   ========================================================= */
function hookPagination(fnName, tbodyId) {
    function tryHook() {
        if (typeof window[fnName] !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window[fnName];
        window[fnName] = function (...args) {
            const result = original.apply(this, args);
            applyPaginationToTable(tbodyId, fnName);
            return result;
        };
    }
    tryHook();
}

hookPagination('renderProducts', 'product-tbody');
hookPagination('renderClerks', 'clerk-tbody');
hookPagination('renderHistory', 'history-tbody');
hookPagination('renderTimecardTable', 'timecard-tbody');

// 商品・担当者・履歴・タイムカードの各画面を開き直した時は1ページ目から見せたい場合、
// showScreen() 実行時に該当画面ならページを1にリセットする
(function hookPaginationResetOnScreenOpen() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalShowScreen = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const resetMap = {
                'product-screen': 'product-tbody',
                'clerk-screen': 'clerk-tbody',
                'history-screen': 'history-tbody',
                'timecard-screen': 'timecard-tbody'
            };
            if (resetMap[screenId]) resetPaginationPage(resetMap[screenId]);
            return originalShowScreen.apply(this, [screenId, ...rest]);
        };
    }
    tryHook();
})();
