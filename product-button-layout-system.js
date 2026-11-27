// ==========================================
// product-button-layout-system.js
// レジ画面の「商品ボタン」を、大きさ・配置を自由に変えられるようにする。写真も入れられる。
//
// 【使いかた】
//  ・商品名の検索欄の下に「🧩 配置・大きさを編集」ボタンが出る。押すと編集モード。
//  ・編集モード中：
//      ボタンをドラッグ … 動かす（10pxきざみでピタッと揃う）
//      右下の ◢ をドラッグ … 大きさを変える
//      左上の 📷 … 写真を選ぶ（ボタンの背景になる）／ 🗑 … 写真をはずす
//  ・「✅ 編集を終わる」で通常のレジ画面に戻る。
//  ・配置は「ジャンルのタブごと」に覚える（「すべて」「飲料/お酒」…それぞれ別の配置）。
//  ・商品名で検索しているときは、配置は使わず自動で並べる。
//
// 【保存先】
//  ・配置（位置・大きさ）… この端末(localStorage: pos_product_btn_layout_v1) ＋ Firebase
//  ・写真 … 縮小して「dataURL（文字列）」にし、Firebase Realtime Database に保存
//            （この端末にも控えを持つので、オフラインでも表示できる）
//  ・Firebaseの保存場所（お店ごとに分ける）:
//       product_button_layout/<店キー>        … 配置
//       product_button_images/<店キー>/<商品>  … 写真(dataURL)
//    <店キー> は「データ用コード」のハッシュ（コードそのものは保存しない）。
//    見つからないときは 'default'。固定したいときは、このファイルより前に
//       window.HARU_BTN_SHOP_KEY = 'お店の名前';
//    を書いておく。
//
// ・register.js / index.html / style.css は変更しない（generateCustomButtons を差し替える方式）。
// ==========================================
(function productButtonLayout() {
    'use strict';
    if (window.__productButtonLayoutInstalled) return;
    window.__productButtonLayoutInstalled = true;

    const LS_LAYOUT = 'pos_product_btn_layout_v1';          // pos_ で始まる → 他の端末への同期・バックアップの対象
    const LS_IMG_CACHE = 'haru_product_btn_img_cache_v1';   // 写真の控え（この端末だけ）
    const GRID = 10;            // ピタッと揃える間隔(px)
    const GAP = 8;              // ボタン同士のすき間(px)
    const DEF_W = 120, DEF_H = 76;
    const MIN_W = 60, MIN_H = 40;
    const IMG_MAX = 320;        // 写真の長い辺の最大(px)
    const IMG_QUALITY = 0.8;

    let editMode = false;
    let layoutObj = loadLayout();             // { updatedAt, data: { <ジャンル>: { <商品>: {x,y,w,h} } } }
    let images = loadImgCache();              // { <商品キー>: dataURL }
    let cur = { gKey: '', rects: {}, keys: {} };   // いま画面に出している配置
    let saveTimer = null;
    let fbStarted = false;
    let dragging = false;

    /* ---------- 小さな道具 ---------- */
    function fbSafe(s) { return encodeURIComponent(String(s)).replace(/\./g, '%2E').replace(/\*/g, '%2A'); }
    function snap(n) { return Math.round(n / GRID) * GRID; }
    function esc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function prodKey(p) { return fbSafe(p.jan || p.id || p.name || ''); }
    function toast(msg) {
        try {
            let t = document.getElementById('pbl-toast');
            if (!t) {
                t = document.createElement('div');
                t.id = 'pbl-toast';
                document.body.appendChild(t);
            }
            t.textContent = msg;
            t.style.opacity = '1';
            clearTimeout(t._h);
            t._h = setTimeout(() => { t.style.opacity = '0'; }, 2600);
        } catch (e) { /* 無視 */ }
    }
    function registerActive() {
        const s = document.getElementById('register-screen');
        return !!(s && s.classList.contains('active'));
    }

    /* ---------- 保存・読み込み（この端末） ---------- */
    function loadLayout() {
        try {
            const o = JSON.parse(localStorage.getItem(LS_LAYOUT) || 'null');
            if (o && typeof o === 'object' && o.data) return { updatedAt: Number(o.updatedAt) || 0, data: o.data };
        } catch (e) { /* 無視 */ }
        return { updatedAt: 0, data: {} };
    }
    function saveLayoutLocal() {
        try { localStorage.setItem(LS_LAYOUT, JSON.stringify(layoutObj)); } catch (e) { /* 無視 */ }
    }
    function loadImgCache() {
        try {
            const o = JSON.parse(localStorage.getItem(LS_IMG_CACHE) || '{}');
            if (o && typeof o === 'object') return o;
        } catch (e) { /* 無視 */ }
        return {};
    }
    function saveImgCache() {
        try { localStorage.setItem(LS_IMG_CACHE, JSON.stringify(images)); } catch (e) { /* 容量オーバーなどは無視（Firebaseに残る） */ }
    }

    /* ---------- Firebase ---------- */
    let shopKeyCache = null;
    async function getShopKey() {
        if (shopKeyCache) return shopKeyCache;
        let raw = window.HARU_BTN_SHOP_KEY || '';
        if (!raw) {
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (/sync.*code|data.?code|share.?code|room.?code/i.test(k)) {
                        const v = localStorage.getItem(k);
                        if (v && typeof v === 'string' && v.length >= 4 && v.length < 200) { raw = v; break; }
                    }
                }
            } catch (e) { /* 無視 */ }
        }
        if (!raw) { shopKeyCache = 'default'; return shopKeyCache; }
        try {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('harureji-btn:' + raw));
            shopKeyCache = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
        } catch (e) {
            shopKeyCache = fbSafe(raw).slice(0, 40);
        }
        return shopKeyCache;
    }
    function fbDb() {
        try { return (window.firebase && firebase.apps && firebase.apps.length) ? firebase.database() : null; } catch (e) { return null; }
    }

    async function startFirebase(retry) {
        if (fbStarted) return;
        const db = fbDb();
        if (!db) {
            if ((retry || 0) < 10) setTimeout(() => startFirebase((retry || 0) + 1), 2000);
            return;
        }
        fbStarted = true;
        let shop;
        try { shop = await getShopKey(); } catch (e) { shop = 'default'; }

        // 配置
        try {
            db.ref('product_button_layout/' + shop).on('value', snap => {
                const v = snap.val();
                if (!v || !v.updatedAt) {
                    // Firebaseがまだ空で、この端末に配置があれば、アップロードしておく
                    if (layoutObj.updatedAt > 0) pushLayout();
                    return;
                }
                if (v.updatedAt > layoutObj.updatedAt && !dragging && !editMode) {
                    layoutObj = { updatedAt: v.updatedAt, data: v.data || {} };
                    saveLayoutLocal();
                    if (registerActive()) render();
                }
            }, err => console.warn('配置の読み込みに失敗', err));
        } catch (e) { console.warn(e); }

        // 写真
        try {
            const iref = db.ref('product_button_images/' + shop);
            const onImg = s => { if (typeof s.val() === 'string') { images[s.key] = s.val(); saveImgCache(); if (registerActive() && !dragging) render(); } };
            iref.on('child_added', onImg, err => console.warn('写真の読み込みに失敗', err));
            iref.on('child_changed', onImg);
            iref.on('child_removed', s => { delete images[s.key]; saveImgCache(); if (registerActive() && !dragging) render(); });
        } catch (e) { console.warn(e); }
    }

    async function pushLayout() {
        const db = fbDb();
        if (!db) return;
        try {
            const shop = await getShopKey();
            await db.ref('product_button_layout/' + shop).set({ updatedAt: layoutObj.updatedAt, data: layoutObj.data });
        } catch (e) {
            console.warn('配置のFirebase保存に失敗', e);
            toast('⚠️ 配置をFirebaseに保存できませんでした（この端末には保存済み）');
        }
    }
    function scheduleSaveLayout() {
        layoutObj.updatedAt = Date.now();
        saveLayoutLocal();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(pushLayout, 700);
    }

    async function pushImage(key, dataUrl) {
        const db = fbDb();
        if (!db) { toast('⚠️ Firebaseにつながっていません（この端末には保存しました）'); return; }
        try {
            const shop = await getShopKey();
            const r = db.ref('product_button_images/' + shop + '/' + key);
            if (dataUrl) await r.set(dataUrl); else await r.remove();
        } catch (e) {
            console.warn('写真のFirebase保存に失敗', e);
            toast('⚠️ 写真をFirebaseに保存できませんでした（この端末には保存しました）');
        }
    }

    /* ---------- 写真：選ぶ → 縮小 → dataURL ---------- */
    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try {
                    let w = img.naturalWidth, h = img.naturalHeight;
                    const scale = Math.min(1, IMG_MAX / Math.max(w, h));
                    w = Math.max(1, Math.round(w * scale));
                    h = Math.max(1, Math.round(h * scale));
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(c.toDataURL('image/jpeg', IMG_QUALITY));
                } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めません')); };
            img.src = url;
        });
    }
    let fileInput = null;
    function pickImage(key) {
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
        }
        fileInput.value = '';
        fileInput.onchange = async () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) return;
            try {
                const dataUrl = await fileToDataUrl(f);
                images[key] = dataUrl;
                saveImgCache();
                render();
                toast('📷 写真を設定しました');
                pushImage(key, dataUrl);
            } catch (e) {
                console.warn(e);
                toast('⚠️ 写真を読み込めませんでした');
            }
        };
        fileInput.click();
    }
    function removeImage(key) {
        delete images[key];
        saveImgCache();
        render();
        pushImage(key, null);
    }

    /* ---------- 見た目（CSS） ---------- */
    function ensureStyle() {
        if (document.getElementById('pbl-style')) return;
        const st = document.createElement('style');
        st.id = 'pbl-style';
        st.textContent = `
        #custom-buttons-area.pbl-on { display: block !important; position: relative !important; overflow: auto !important; grid-template-columns: none !important; }
        #custom-buttons-area .pbl-canvas { position: relative; width: 100%; }
        #custom-buttons-area .pbl-btn { position: absolute !important; margin: 0 !important; min-width: 0 !important; min-height: 0 !important; aspect-ratio: auto !important;
            box-sizing: border-box !important; padding: 0 !important; overflow: hidden !important; display: block !important; text-align: left; touch-action: manipulation; }
        #custom-buttons-area .pbl-bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
        #custom-buttons-area .pbl-label { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 6px; box-sizing: border-box; line-height: 1.2; text-align: center;
            display: flex; flex-direction: column; justify-content: center; }
        #custom-buttons-area .pbl-btn:not(.pbl-has-img) .pbl-label { top: 0; }
        #custom-buttons-area .pbl-has-img .pbl-label { background: rgba(0,0,0,.58); color: #fff; }
        #custom-buttons-area .pbl-label b { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; word-break: break-all; }
        #custom-buttons-area .pbl-label small { display: block; opacity: .95; }
        #custom-buttons-area .pbl-star { position: absolute; top: 2px; right: 3px; font-size: 11px; line-height: 1; }
        #custom-buttons-area .pbl-edit { outline: 2px dashed #ff9800; outline-offset: -2px; cursor: move; touch-action: none !important; user-select: none; -webkit-user-select: none; }
        #custom-buttons-area .pbl-resize { position: absolute; right: 0; bottom: 0; width: 30px; height: 30px; background: #ff9800; color: #fff; font-size: 18px; line-height: 30px;
            text-align: center; border-top-left-radius: 8px; cursor: nwse-resize; touch-action: none; z-index: 3; }
        #custom-buttons-area .pbl-cam, #custom-buttons-area .pbl-del { position: absolute; top: 0; width: 30px; height: 30px; background: rgba(255,255,255,.92); color: #333; font-size: 16px;
            line-height: 30px; text-align: center; cursor: pointer; z-index: 3; border-bottom-right-radius: 8px; }
        #custom-buttons-area .pbl-cam { left: 0; }
        #custom-buttons-area .pbl-del { left: 32px; border-radius: 0 0 8px 0; }
        #pbl-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 4px 0 6px; font-size: 13px; }
        #pbl-toolbar button { padding: 6px 12px; border: none; border-radius: 6px; font-weight: 700; font-size: 13px; cursor: pointer; background: #607d8b; color: #fff; }
        #pbl-toolbar button.pbl-done { background: #2e7d32; }
        #pbl-toolbar button.pbl-reset { background: #8d6e63; }
        #pbl-toolbar .pbl-hint { color: #e65100; font-weight: 700; }
        #pbl-toast { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%); background: rgba(33,33,33,.92); color: #fff; padding: 10px 16px; border-radius: 8px;
            font-size: 14px; z-index: 100000; opacity: 0; transition: opacity .25s; pointer-events: none; max-width: 90vw; }
        `;
        document.head.appendChild(st);
    }

    /* ---------- ツールバー ---------- */
    function ensureToolbar() {
        let bar = document.getElementById('pbl-toolbar');
        if (!bar) {
            const anchor = document.querySelector('#register-screen .product-search-box');
            if (!anchor) return;
            ensureStyle();
            bar = document.createElement('div');
            bar.id = 'pbl-toolbar';
            anchor.insertAdjacentElement('afterend', bar);
        }
        updateToolbar();
    }
    function updateToolbar() {
        const bar = document.getElementById('pbl-toolbar');
        if (!bar) return;
        if (!editMode) {
            bar.innerHTML = '<button type="button" id="pbl-start">🧩 配置・大きさを編集</button>';
            bar.querySelector('#pbl-start').onclick = startEdit;
        } else {
            bar.innerHTML =
                '<button type="button" class="pbl-done" id="pbl-finish">✅ 編集を終わる</button>' +
                '<button type="button" class="pbl-reset" id="pbl-reset">↺ このタブを自動配置に戻す</button>' +
                '<span class="pbl-hint">ドラッグで移動 ／ 右下の◢で大きさ ／ 📷で写真</span>';
            bar.querySelector('#pbl-finish').onclick = finishEdit;
            bar.querySelector('#pbl-reset').onclick = resetCurrentTab;
        }
    }
    function startEdit() {
        const s = document.getElementById('product-name-search');
        if (s && s.value.trim()) { toast('商品名の検索を空にしてから編集してね'); return; }
        editMode = true;
        updateToolbar();
        render();
    }
    function finishEdit() {
        editMode = false;
        commitAll();
        updateToolbar();
        render();
        try { if (typeof focusJanInput === 'function') focusJanInput(); } catch (e) { /* 無視 */ }
    }
    function resetCurrentTab() {
        const doIt = () => {
            delete layoutObj.data[cur.gKey];
            scheduleSaveLayout();
            render();
        };
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('このタブのボタンの配置・大きさを、初期の自動配置に戻しますか？（写真はそのまま残ります）', 'はいち を もとに もどし ます か？', res => { if (res) doIt(); }, true);
        } else if (window.confirm('このタブの配置を初期の自動配置に戻しますか？')) {
            doIt();
        }
    }

    /* ---------- 配置の計算 ---------- */
    function intersects(a, b) {
        return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
    }
    // saved=保存済みの位置・大きさ。無いものは左上から順に空きへ並べる
    function computeRects(list, saved, areaW, ignoreSavedPos) {
        const rects = {};
        const placed = [];
        const W = Math.max(areaW || 0, 300);
        const pending = [];
        list.forEach(p => {
            const k = prodKey(p);
            const s = saved[k];
            if (s && !ignoreSavedPos && isFinite(s.x) && isFinite(s.y)) {
                const r = { x: Math.max(0, +s.x), y: Math.max(0, +s.y), w: Math.max(MIN_W, +s.w || DEF_W), h: Math.max(MIN_H, +s.h || DEF_H) };
                rects[k] = r;
                placed.push(r);
            } else {
                pending.push({ k, w: Math.max(MIN_W, (s && +s.w) || DEF_W), h: Math.max(MIN_H, (s && +s.h) || DEF_H) });
            }
        });
        let cx = GAP, cy = GAP, rowH = 0;
        pending.forEach(it => {
            for (let guard = 0; guard < 5000; guard++) {
                if (cx + it.w > W - GAP && cx > GAP) { cx = GAP; cy += rowH + GAP; rowH = 0; }
                const test = { x: cx, y: cy, w: it.w, h: it.h };
                const hit = placed.find(r => intersects(test, r));
                if (hit) { cx = hit.x + hit.w + GAP; continue; }
                break;
            }
            const r = { x: cx, y: cy, w: it.w, h: it.h };
            rects[it.k] = r;
            placed.push(r);
            cx += it.w + GAP;
            rowH = Math.max(rowH, it.h);
        });
        return rects;
    }

    function commitAll() {
        if (!cur.gKey) return;
        const g = layoutObj.data[cur.gKey] = layoutObj.data[cur.gKey] || {};
        Object.keys(cur.rects).forEach(k => {
            const r = cur.rects[k];
            g[k] = { x: r.x, y: r.y, w: r.w, h: r.h };
        });
        scheduleSaveLayout();
    }

    /* ---------- 描画（generateCustomButtons の差し替え） ---------- */
    function styleBtn(btn, r, hasImg) {
        btn.style.left = r.x + 'px';
        btn.style.top = r.y + 'px';
        btn.style.width = r.w + 'px';
        btn.style.height = r.h + 'px';
        const fs = Math.max(11, Math.min(22, Math.round(Math.min(r.w / 7.5, r.h / 3.4))));
        btn.style.fontSize = fs + 'px';
    }

    function render() {
        const area = document.getElementById('custom-buttons-area');
        if (!area) return;
        ensureStyle();
        ensureToolbar();
        if (!fbStarted) startFirebase(0);

        area.innerHTML = '';
        area.classList.add('pbl-on');

        let list = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
        const genre = (typeof selectedGenreFilter !== 'undefined') ? selectedGenreFilter : 'すべて';
        if (genre !== 'すべて') list = list.filter(p => (p.genre || 'その他商品') === genre);

        const sInput = document.getElementById('product-name-search');
        const searchTerm = sInput ? sInput.value.trim().toLowerCase() : '';
        if (searchTerm) list = list.filter(p => (p.name || '').toLowerCase().includes(searchTerm));

        if (list.length === 0) {
            const msg = searchTerm ? `「${esc(searchTerm)}」に該当する商品はありません` : `「${esc(genre)}」に該当する商品はありません`;
            area.innerHTML = `<div style="text-align:center;color:#888;padding:20px;">${msg}</div>`;
            cur = { gKey: '', rects: {}, keys: {} };
            return;
        }

        // よく使う商品ほど先に（元の並びと同じ）
        list = list.slice().sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

        const gKey = fbSafe(genre);
        const saved = layoutObj.data[gKey] || {};
        const searching = !!searchTerm;
        const rects = computeRects(list, saved, area.clientWidth, searching);
        cur = { gKey: searching ? '' : gKey, rects, keys: {} };

        const canvas = document.createElement('div');
        canvas.className = 'pbl-canvas';
        const fitCanvas = () => {
            let bottom = 0;
            Object.keys(cur.rects).forEach(k => { bottom = Math.max(bottom, cur.rects[k].y + cur.rects[k].h); });
            canvas.style.height = Math.max(160, bottom + GAP + (editMode ? 60 : 0)) + 'px';
        };

        list.forEach(prod => {
            const k = prodKey(prod);
            cur.keys[k] = prod;
            const r = rects[k];
            const img = images[k];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'action-btn blue pbl-btn' + (img ? ' pbl-has-img' : '') + (editMode ? ' pbl-edit' : '');
            btn.dataset.pk = k;
            styleBtn(btn, r, !!img);

            const star = (prod.usageCount || 0) >= 3 ? '<span class="pbl-star">⭐</span>' : '';
            const bg = img ? `<span class="pbl-bg" style="background-image:url('${img}')"></span>` : '';
            const price = (Number(prod.price) || 0).toLocaleString();
            btn.innerHTML = `${bg}${star}<span class="pbl-label"><b>${esc(prod.name)}</b><small>¥${price}</small></span>`;

            if (!editMode) {
                btn.onclick = () => {
                    if (typeof playSound === 'function') playSound('click');
                    if (typeof checkAndAddToCart === 'function') checkAndAddToCart(prod);
                    if (typeof focusJanInput === 'function') focusJanInput();
                };
            } else {
                btn.onclick = e => e.preventDefault();

                const cam = document.createElement('span');
                cam.className = 'pbl-cam'; cam.textContent = '📷'; cam.title = '写真を選ぶ';
                cam.addEventListener('pointerdown', e => e.stopPropagation());
                cam.addEventListener('click', e => { e.stopPropagation(); pickImage(k); });
                btn.appendChild(cam);

                if (img) {
                    const del = document.createElement('span');
                    del.className = 'pbl-del'; del.textContent = '🗑'; del.title = '写真をはずす';
                    del.addEventListener('pointerdown', e => e.stopPropagation());
                    del.addEventListener('click', e => { e.stopPropagation(); removeImage(k); });
                    btn.appendChild(del);
                }

                const hd = document.createElement('span');
                hd.className = 'pbl-resize'; hd.textContent = '◢'; hd.title = '大きさを変える';
                btn.appendChild(hd);

                // ドラッグ（移動／大きさ変更）
                btn.addEventListener('pointerdown', ev => {
                    if (ev.button !== undefined && ev.button !== 0) return;
                    const isResize = ev.target === hd;
                    ev.preventDefault();
                    try { btn.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
                    dragging = true;
                    const start = { px: ev.clientX, py: ev.clientY, r: Object.assign({}, cur.rects[k]) };
                    btn.style.zIndex = 5;

                    const move = e => {
                        const dx = e.clientX - start.px, dy = e.clientY - start.py;
                        const nr = cur.rects[k];
                        if (isResize) {
                            nr.w = Math.max(MIN_W, snap(start.r.w + dx));
                            nr.h = Math.max(MIN_H, snap(start.r.h + dy));
                        } else {
                            nr.x = Math.max(0, snap(start.r.x + dx));
                            nr.y = Math.max(0, snap(start.r.y + dy));
                        }
                        styleBtn(btn, nr, !!img);
                        fitCanvas();
                    };
                    const up = () => {
                        btn.removeEventListener('pointermove', move);
                        btn.removeEventListener('pointerup', up);
                        btn.removeEventListener('pointercancel', up);
                        try { btn.releasePointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
                        btn.style.zIndex = '';
                        dragging = false;
                        commitAll();
                    };
                    btn.addEventListener('pointermove', move);
                    btn.addEventListener('pointerup', up);
                    btn.addEventListener('pointercancel', up);
                });
            }
            canvas.appendChild(btn);
        });

        fitCanvas();
        area.appendChild(canvas);
    }

    /* ---------- 差し替え ---------- */
    window.generateCustomButtons = render;
    window.haruProductButtonLayout = { render, startEdit, finishEdit };

    // 画面の向き・大きさが変わったとき、自動配置のぶんだけ並べ直す
    let rt = null;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => { if (registerActive() && !editMode && !dragging) render(); }, 350);
    });

    // 他の画面へ移るとき、編集モードは自動で終える
    setInterval(() => {
        if (editMode && !registerActive()) { editMode = false; commitAll(); updateToolbar(); }
    }, 1000);

    // 最初の読み込み
    function boot() {
        ensureStyle();
        startFirebase(0);
        if (registerActive()) render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
