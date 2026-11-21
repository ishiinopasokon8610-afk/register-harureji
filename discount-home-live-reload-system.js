// ==========================================
// discount-home-live-reload-system.js
// ------------------------------------------
// 【背景】ホームの「自動化バーコード一覧」は、メモリ上の discountBarcodes だけを見て描く。
// localStorage（pos_discounts）には届いているのに、メモリ側へ反映されていない端末だと、
// タッチパネル／オーダー分のバーコードが一覧に出ない。
// 【この機能】一覧を描く直前、一覧を開いている間（3秒ごと）、他タブ・他処理が localStorage を
// 書き換えた時に、localStorage の中身をメモリへ「混ぜる」（新しい方を採用・消した印も尊重）。
// discount-system.js の discMergeRemote() を使う。index.html で discount-system.js より後ろ、
// できれば home-automation-blocks.js 系の後ろに読み込む。
// ==========================================
(function discountHomeLiveReload() {
    'use strict';

    function mergeFromStorage() {
        try {
            if (typeof discMergeRemote !== 'function' || typeof discountBarcodes === 'undefined') return false;
            const raw = localStorage.getItem('pos_discounts');
            if (!raw) return false;
            const list = JSON.parse(raw);
            if (!Array.isArray(list) || list.length === 0) return false;
            const have = new Set((discountBarcodes || []).map(d => d && String(d.barcode)));
            const lacking = list.some(d => d && !have.has(String(d.barcode)));
            if (!lacking) return false;
            const tomb = (typeof discLoadTombstones === 'function') ? discLoadTombstones() : {};
            discMergeRemote(list, tomb);
            return true;
        } catch (e) {
            console.warn('[discount-live-reload]', e);
            return false;
        }
    }

    function refreshViews() {
        try { if (typeof renderHomeAutomationBlocksIfVisible === 'function') renderHomeAutomationBlocksIfVisible(); } catch (e) {}
        try { if (document.getElementById('discount-tbody') && typeof renderDiscounts === 'function') renderDiscounts(); } catch (e) {}
    }

    // ① 一覧を描く直前に取り込む
    (function hookGrid() {
        function tryHook() {
            if (typeof window.renderHomeAutomationBlocksGrid !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.renderHomeAutomationBlocksGrid.__liveReloadHooked) return;
            const original = window.renderHomeAutomationBlocksGrid;
            const wrapped = function (...args) {
                mergeFromStorage();
                return original.apply(this, args);
            };
            wrapped.__liveReloadHooked = true;
            window.renderHomeAutomationBlocksGrid = wrapped;
        }
        tryHook();
    })();

    // ② 一覧を開いている間、3秒ごとに確認する（足りないものがあった時だけ再描画）
    setInterval(() => {
        const o = document.getElementById('home-automation-blocks-overlay');
        if (!o || o.style.display !== 'block') return;
        if (mergeFromStorage()) refreshViews();
    }, 3000);

    // ③ 他のタブが localStorage を書き換えた時
    window.addEventListener('storage', (e) => {
        if (e.key === 'pos_discounts' && mergeFromStorage()) refreshViews();
    });

    window.discReloadFromStorage = function () { const r = mergeFromStorage(); refreshViews(); return r; };
})();
