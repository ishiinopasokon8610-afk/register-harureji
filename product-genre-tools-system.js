// ==========================================
// product-genre-tools-system.js
// ① 「商品の分類（種類）を自分で一から作る」設定（データ管理画面にスイッチを追加）
//    ONにすると、最初から入っている分類（食品・飲料/お酒 …）は出さず、
//    商品管理で自分が追加した分類だけを使う。OFFに戻せばこれまで通り。
//    ※ すでに商品に付いている分類の名前はそのまま残る（消えるのは選択肢・絞り込みタブの表示だけ）。
//    ※ 設定は pos_genre_from_scratch に保存。「pos_」で始まるので、他の端末にも同期される。
// index.html の最後の方（master-mgmt.js・register.js より後）に読み込む。
// ==========================================
(function productGenreTools() {
    'use strict';
    const KEY = 'pos_genre_from_scratch';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isScratch = () => { try { return localStorage.getItem(KEY) === 'true'; } catch (e) { return false; } };

    /* ---------- ① 分類を一から作る ---------- */
    function hookGetAllGenres() {
        if (typeof window.getAllGenres !== 'function') { setTimeout(hookGetAllGenres, 300); return; }
        if (window.getAllGenres.__scratchHooked) return;
        const original = window.getAllGenres;
        const wrapped = function () {
            if (!isScratch()) return original.apply(this, arguments);
            const customs = (typeof customGenres !== 'undefined' && Array.isArray(customGenres)) ? customGenres : [];
            const out = [];
            customs.forEach(g => { if (g && !out.includes(g)) out.push(g); });
            return out;
        };
        wrapped.__scratchHooked = true;
        window.getAllGenres = wrapped;
        try { getAllGenres = wrapped; } catch (e) { /* 無視 */ }
        refreshGenreUi();
    }
    function refreshGenreUi() {
        ['populateGenreSelects', 'renderCustomGenreList', 'renderGenreFilterButtons', 'renderProductTable'].forEach(fn => {
            try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { /* 無視 */ }
        });
    }
    function setScratch(on) {
        try { localStorage.setItem(KEY, on ? 'true' : 'false'); } catch (e) { /* 無視 */ }
        if (typeof selectedGenreFilter !== 'undefined') { try { selectedGenreFilter = 'すべて'; } catch (e) { /* 無視 */ } }
        refreshGenreUi();
        try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) { /* 無視 */ }
        if (typeof playSound === 'function') playSound('click');
    }
    function ensureSettingBlock() {
        const scr = document.getElementById('migration-screen');
        if (!scr || document.getElementById('genre-scratch-block')) return;
        const b = document.createElement('div');
        b.id = 'genre-scratch-block';
        b.className = 'migration-block';
        b.style.cssText = 'background:#fff8e1;border:2px solid #ffd54f;padding:15px;border-radius:6px;margin-bottom:15px';
        b.innerHTML = '<h3 class="migration-title" style="color:#e65100">🗂️ 商品の分類（種類）</h3>' +
            '<p class="migration-desc">ONにすると、最初から入っている分類（食品・飲料/お酒 など）を使わず、<b>商品管理で自分が追加した分類だけ</b>を使います。すでに商品に付いている分類名は消えません。</p>' +
            '<label style="display:flex;gap:8px;align-items:center;font-weight:700;cursor:pointer"><input type="checkbox" id="genre-scratch-check" style="width:20px;height:20px"> 分類を自分で一から作る</label>';
        const first = scr.querySelector('.migration-block');
        if (first && first.parentNode === scr) scr.insertBefore(b, first); else scr.appendChild(b);
        const cb = b.querySelector('#genre-scratch-check');
        cb.checked = isScratch();
        cb.onchange = () => setScratch(cb.checked);
    }
    window.addEventListener('storage', (e) => { if (e.key === KEY) { const cb = document.getElementById('genre-scratch-check'); if (cb) cb.checked = isScratch(); refreshGenreUi(); } });
    window.addEventListener('pos-setting-synced', (e) => { if (e && e.detail && e.detail.key === KEY) { const cb = document.getElementById('genre-scratch-check'); if (cb) cb.checked = isScratch(); refreshGenreUi(); } });

    function boot() { ensureSettingBlock(); }
    hookGetAllGenres();
    boot();
    setInterval(boot, 1500);
})();
