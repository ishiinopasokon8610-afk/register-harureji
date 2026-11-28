// ==========================================
// product-button-layout-system.js (v2)
// レジ画面の「商品ボタン」を、大きさ・配置を自由に変えられるようにする。写真も入れられる。
//
// 【使いかた】
//  ・商品名の検索欄の下に「🧩 配置・大きさを編集」「✨ おまかせ配置」が出る。
//  ・初期（まだ配置を決めていないとき）は、PCでもスマホでも正方形（角丸）で、PCは「横6列」、スマホは「横3列」に並ぶ。配置はスマホとPCで別々。
//  ・✨ おまかせ配置 … いまのタブの商品を、横○列（初期はPC6・スマホ3）の見やすい並びに、ぜんぶ並べ直して保存する。
//  ・編集モード中：
//      ボタンをドラッグ … 動かす（10pxきざみ）／ 右下の ◢ をドラッグ … 大きさを変える
//      左上の 📷 … 写真を選ぶ ／ 🗑 … 写真をはずす
//  ・配置は「ジャンルのタブごと」に覚える。商品名で検索しているときは、配置は使わず自動で並べる。
//
// 【配置の持ちかた（スマホ・PCで同じ見た目になるように）】
//  ・横の位置と幅は「画面の幅に対する割合」で保存する（PCで作った配置が、スマホでもはみ出さない）。
//  ・縦の位置と高さは px で保存する。
//
// 【保存先】
//  ・配置 … この端末(localStorage: haru_product_btn_layout_v2) ＋ Firebase ＋ Google Driveのバックアップ（productButtonLayout として入る）
//            ※ pos_ で始まるキーは、データ同期の処理に消される場合があるので使わない。
//  ・写真 … 縮小して dataURL にし、Firebase Realtime Database に保存（この端末にも控えを持つ）
//  ・Firebaseの保存場所（ルールの変更は不要）:
//       pos_sync/<データ用コード>/product_buttons/layout        … 配置
//       pos_sync/<データ用コード>/product_buttons/images/<商品>  … 写真(dataURL)
//    すでにルールで許可されている pos_sync/<コード> の下を使う。
//    「データ用コード」が設定されていない端末は、Firebaseには保存せず、この端末とDriveバックアップだけに保存する。
// ==========================================
(function productButtonLayout() {
    'use strict';
    if (window.__productButtonLayoutInstalled) return;
    window.__productButtonLayoutInstalled = true;

    const LS_LAYOUT = 'haru_product_btn_layout_v2';
    const LS_IMG_CACHE = 'haru_product_btn_img_cache_v1';
    const LS_COLS = 'haru_product_btn_cols_v2';
    const GRID = 5;
    const GAP = 6;
    const MAX_SIDE = 180;       // 自動で並べるときの、正方形の一辺の上限(px)
    const MIN_W = 20;   // 横10列がスマホでも入るように、幅の下限は小さめ
    const IMG_MAX = 320;
    const IMG_QUALITY = 0.8;
    const DEFAULT_COLS = 6;     // PC・タブレットの初期は横6列
    const DEFAULT_COLS_SP = 3;  // スマホの初期は横3列
    const LS_COLS_SP = 'haru_product_btn_cols_sp_v1';

    let editMode = false;
    let layoutObj = loadLayout();   // { updatedAt, data: { <ジャンル>: { <商品>: {fx, y, fw, h} } } }
    let images = loadImgCache();
    let cur = { gKey: '', rects: {}, keys: {}, W: 0 };
    let saveTimer = null;
    let fbStarted = false;
    let dragging = false;
    let pushedEmptyOnce = false;
    const status = { local: '', fb: '' };

    /* ---------- 小さな道具 ---------- */
    function fbSafe(s) { return encodeURIComponent(String(s)).replace(/\./g, '%2E').replace(/\*/g, '%2A'); }
    function snap(n) { return Math.round(n / GRID) * GRID; }
    function r4(n) { return Math.round(n * 10000) / 10000; }
    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
    function esc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function prodKey(p) { return fbSafe(p.jan || p.id || p.name || ''); }
    function toast(msg) {
        try {
            let t = document.getElementById('pbl-toast');
            if (!t) { t = document.createElement('div'); t.id = 'pbl-toast'; document.body.appendChild(t); }
            t.textContent = msg;
            t.style.opacity = '1';
            clearTimeout(t._h);
            t._h = setTimeout(() => { t.style.opacity = '0'; }, 2800);
        } catch (e) { /* 無視 */ }
    }
    function registerActive() {
        const s = document.getElementById('register-screen');
        return !!(s && s.classList.contains('active'));
    }
    // スマホかどうか（縦向き＝画面の幅が狭い／横向き＝画面の短い辺が狭い）
    function isPhone() {
        return window.innerWidth <= 700 || Math.min(window.screen.width, window.screen.height) <= 500;
    }
    function readCols(key, def) {
        const n = parseInt(localStorage.getItem(key) || '', 10);
        return (n >= 1 && n <= 10) ? n : def;
    }
    function writeCols(key, n) { try { localStorage.setItem(key, String(n)); } catch (e) { /* 無視 */ } }
    function getCols() { return isPhone() ? readCols(LS_COLS_SP, DEFAULT_COLS_SP) : readCols(LS_COLS, DEFAULT_COLS); }
    function setCols(n) { writeCols(isPhone() ? LS_COLS_SP : LS_COLS, n); }
    // 配置は、スマホとPCで別々に覚える
    function layoutKey(genre) { return fbSafe(genre) + (isPhone() ? '__sp' : ''); }

    /* ---------- 保存・読み込み（この端末） ---------- */
    function loadLayout() {
        try {
            const o = JSON.parse(localStorage.getItem(LS_LAYOUT) || 'null');
            if (o && typeof o === 'object' && o.data) return { updatedAt: Number(o.updatedAt) || 0, data: o.data };
        } catch (e) { /* 無視 */ }
        return { updatedAt: 0, data: {} };
    }
    function saveLayoutLocal() {
        try { localStorage.setItem(LS_LAYOUT, JSON.stringify(layoutObj)); status.local = 'ok'; }
        catch (e) { status.local = 'ng'; console.warn('配置をこの端末に保存できません', e); }
        updateStatus();
    }
    function loadImgCache() {
        try { const o = JSON.parse(localStorage.getItem(LS_IMG_CACHE) || '{}'); if (o && typeof o === 'object') return o; } catch (e) { /* 無視 */ }
        return {};
    }
    function saveImgCache() {
        try { localStorage.setItem(LS_IMG_CACHE, JSON.stringify(images)); } catch (e) { /* 容量オーバーなどは無視 */ }
    }

    /* ---------- Firebase ---------- */
    // 保存先は、すでにルールで許可されている「pos_sync/<データ用コード>/」の下にする。
    //   pos_sync/<コード>/product_buttons/layout          … 配置
    //   pos_sync/<コード>/product_buttons/images/<商品>    … 写真(dataURL)
    // （ルールの変更は不要。データ用コード＝他の端末とつなぐ「合言葉」が設定されている端末だけ保存できる）
    function syncCodeInfo() {
        let raw = '';
        try { raw = (window.PosSync && PosSync.getCode && PosSync.getCode()) || ''; } catch (e) { /* 無視 */ }
        if (!raw) { try { raw = localStorage.getItem('pos_sync_code') || ''; } catch (e) { /* 無視 */ } }
        if (!raw || typeof raw !== 'string') return { code: '', reason: 'none' };
        let norm = raw;
        try { if (window.PosSync && PosSync.normalizeCode) norm = PosSync.normalizeCode(raw) || raw; } catch (e) { /* 無視 */ }
        const cands = [norm, raw].map(x => String(x).toLowerCase().replace(/[\s-]/g, ''));
        for (const c of cands) if (/^[0-9a-f]{32}$/.test(c)) return { code: c, reason: 'ok' };
        return { code: '', reason: 'format', len: raw.length };
    }
    function getSyncCode() { return syncCodeInfo().code; }
    function baseRef(db) {
        const code = getSyncCode();
        return code ? db.ref('pos_sync/' + code + '/product_buttons') : null;
    }
    function fbDb() {
        try { return (window.firebase && firebase.apps && firebase.apps.length) ? firebase.database() : null; } catch (e) { return null; }
    }
    function fbErrText(e) {
        const code = (e && (e.code || e.message)) || '';
        if (/PERMISSION_DENIED/i.test(code)) return '権限がありません（Firebaseのルールを確認してください）';
        return String(code || 'エラー').slice(0, 60);
    }

    let listenCode = '';
    function startFirebase(retry) {
        const db = fbDb();
        if (!db) {
            if ((retry || 0) < 10) setTimeout(() => startFirebase((retry || 0) + 1), 2000);
            else { status.fb = 'off'; updateStatus(); }
            return;
        }
        const code = getSyncCode();
        if (!code) { status.fb = 'nocode'; updateStatus(); return; }     // データ用コードが決まったら、改めて始める
        if (fbStarted && listenCode === code) return;
        fbStarted = true;
        listenCode = code;
        pushedEmptyOnce = false;
        const base = db.ref('pos_sync/' + code + '/product_buttons');

        try {
            base.child('layout').on('value', s => {
                const v = s.val();
                if (!v || !v.updatedAt) {
                    // Firebaseがまだ空で、この端末に配置があるときは、1回だけ送っておく
                    if (layoutObj.updatedAt > 0 && !pushedEmptyOnce) { pushedEmptyOnce = true; pushLayout(); }
                    return;
                }
                if (v.updatedAt > layoutObj.updatedAt && !dragging && !editMode) {
                    layoutObj = { updatedAt: v.updatedAt, data: v.data || {} };
                    saveLayoutLocal();
                    if (registerActive()) render();
                }
                if (!status.fb || status.fb === 'nocode') { status.fb = 'ok'; updateStatus(); }
            }, err => { console.warn('配置の読み込みに失敗', err); status.fb = 'ng:' + fbErrText(err); updateStatus(); });
        } catch (e) { console.warn(e); }

        try {
            const iref = base.child('images');
            const onImg = s => { if (typeof s.val() === 'string') { images[s.key] = s.val(); saveImgCache(); if (registerActive() && !dragging) render(); } };
            iref.on('child_added', onImg, err => console.warn('写真の読み込みに失敗', err));
            iref.on('child_changed', onImg);
            iref.on('child_removed', s => { delete images[s.key]; saveImgCache(); if (registerActive() && !dragging) render(); });
        } catch (e) { console.warn(e); }
    }
    // データ用コードが発行・入力されたとき、すぐ始める
    window.addEventListener('pos-sync-code-changed', () => { setTimeout(() => startFirebase(0), 500); });
    // コードがまだ無い間は、ときどき確かめる
    setInterval(() => { if (!fbStarted || listenCode !== getSyncCode()) { if (getSyncCode()) startFirebase(0); } }, 5000);

    async function pushLayout() {
        const db = fbDb();
        if (!db) { status.fb = 'off'; updateStatus(); return; }
        const base = baseRef(db);
        if (!base) { status.fb = 'nocode'; updateStatus(); return; }
        try {
            await base.child('layout').set({ updatedAt: layoutObj.updatedAt, data: layoutObj.data });
            status.fb = 'ok';
        } catch (e) {
            console.warn('配置のFirebase保存に失敗', e);
            status.fb = 'ng:' + fbErrText(e);
        }
        updateStatus();
    }
    function scheduleSaveLayout() {
        layoutObj.updatedAt = Date.now();
        saveLayoutLocal();
        status.fb = 'saving';
        updateStatus();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(pushLayout, 600);
        scheduleDriveBackup();
    }

    // Google Driveと連携している端末は、配置・写真を変えたあと少し待って、Driveのバックアップも最新にする
    let driveTimer = null;
    function scheduleDriveBackup() {
        clearTimeout(driveTimer);
        driveTimer = setTimeout(() => {
            try {
                if (localStorage.getItem('pos_gdrive_connected') !== 'true') return;
                if (typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice()) return;
                if (typeof backupToGoogleDriveNow === 'function') backupToGoogleDriveNow(true);
            } catch (e) { /* 無視 */ }
        }, 8000);
    }

    async function pushImage(key, dataUrl) {
        const db = fbDb();
        const base = db ? baseRef(db) : null;
        if (!base) { toast('⚠️ データ用コードが未設定のため、写真はこの端末（とDriveバックアップ）にだけ保存しました'); return; }
        try {
            const r = base.child('images').child(key);
            if (dataUrl) await r.set(dataUrl); else await r.remove();
        } catch (e) {
            console.warn('写真のFirebase保存に失敗', e);
            toast('⚠️ 写真をFirebaseに保存できません：' + fbErrText(e));
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
                scheduleDriveBackup();
            } catch (e) { console.warn(e); toast('⚠️ 写真を読み込めませんでした'); }
        };
        fileInput.click();
    }
    function removeImage(key) {
        delete images[key];
        saveImgCache();
        render();
        pushImage(key, null);
        scheduleDriveBackup();
    }

    /* ---------- 見た目（CSS） ---------- */
    function ensureStyle() {
        if (document.getElementById('pbl-style')) return;
        const st = document.createElement('style');
        st.id = 'pbl-style';
        st.textContent = `
        #custom-buttons-area.pbl-on { display: block !important; position: relative !important; overflow-y: scroll !important; overflow-x: hidden !important; grid-template-columns: none !important; }
        #custom-buttons-area .pbl-canvas { position: relative; width: 100%; }
        #custom-buttons-area .pbl-btn { position: absolute !important; margin: 0 !important; min-width: 0 !important; min-height: 0 !important; aspect-ratio: auto !important;
            box-sizing: border-box !important; padding: 0 !important; border-radius: 14px !important; overflow: hidden !important; display: block !important; text-align: left; touch-action: manipulation; }
        #custom-buttons-area .pbl-bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
        #custom-buttons-area .pbl-label { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 6px; box-sizing: border-box; line-height: 1.2; text-align: center;
            display: flex; flex-direction: column; justify-content: center; }
        #custom-buttons-area .pbl-btn:not(.pbl-has-img) .pbl-label { top: 0; }
        #custom-buttons-area .pbl-has-img .pbl-label { background: rgba(0,0,0,.58); color: #fff; }
        #custom-buttons-area .pbl-label b { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; word-break: break-all; }
        #custom-buttons-area .pbl-label small { display: block; opacity: .95; }
        #custom-buttons-area .pbl-star { position: absolute; top: 1px; right: 2px; font-size: 9px; line-height: 1; opacity: .8; }
        #custom-buttons-area .pbl-edit { outline: 2px dashed #ff9800; outline-offset: -2px; cursor: move; touch-action: none !important; user-select: none; -webkit-user-select: none; }
        #custom-buttons-area .pbl-resize { position: absolute; right: 0; bottom: 0; width: 30px; height: 30px; background: #ff9800; color: #fff; font-size: 18px; line-height: 30px;
            text-align: center; border-top-left-radius: 8px; cursor: nwse-resize; touch-action: none; z-index: 3; }
        #custom-buttons-area .pbl-cam, #custom-buttons-area .pbl-del { position: absolute; top: 0; width: 30px; height: 30px; background: rgba(255,255,255,.92); color: #333; font-size: 16px;
            line-height: 30px; text-align: center; cursor: pointer; z-index: 3; border-bottom-right-radius: 8px; }
        #custom-buttons-area .pbl-cam { left: 0; }
        #custom-buttons-area .pbl-del { left: 32px; border-radius: 0 0 8px 0; }
        #pbl-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; margin: 2px 0 4px; font-size: 12px; }
        #pbl-toolbar button, #pbl-toolbar select { padding: 4px 10px; border: none; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; background: #607d8b; color: #fff; min-height: 0; line-height: 1.3; }
        #pbl-toolbar select { background: #eceff1; color: #263238; padding: 3px 4px; }
        #pbl-toolbar button.pbl-done { background: #2e7d32; }
        #pbl-toolbar button.pbl-auto { background: #f57c00; }
        #pbl-toolbar .pbl-hint { color: #e65100; font-weight: 700; }
        #pbl-toolbar .pbl-status { font-size: 12px; color: #607d8b; }
        #pbl-toolbar .pbl-status.pbl-bad { color: #c62828; font-weight: 700; }
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
            buildToolbar();
        }
    }
    function buildToolbar() {
        const bar = document.getElementById('pbl-toolbar');
        if (!bar) return;
        const cols = getCols();
        const opts = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}"${n === cols ? ' selected' : ''}>横${n}列</option>`).join('');
        bar.innerHTML = editMode
            ? '<button type="button" class="pbl-done" id="pbl-finish">✅ 編集を終わる</button>' +
              '<button type="button" class="pbl-auto" id="pbl-auto">✨ おまかせ配置</button>' +
              `<select id="pbl-cols" title="おまかせ配置の列の数">${opts}</select>` +
              '<span class="pbl-hint">ドラッグで移動 ／ 右下の◢で大きさ ／ 📷で写真</span>' +
              '<span class="pbl-status" id="pbl-status"></span>'
            : '<button type="button" id="pbl-start">🧩 配置・大きさを編集</button>' +
              '<button type="button" class="pbl-auto" id="pbl-auto">✨ おまかせ配置</button>' +
              `<select id="pbl-cols" title="おまかせ配置の列の数">${opts}</select>` +
              '<span class="pbl-status" id="pbl-status"></span>';
        const f = bar.querySelector('#pbl-finish'); if (f) f.onclick = finishEdit;
        const s = bar.querySelector('#pbl-start'); if (s) s.onclick = startEdit;
        bar.querySelector('#pbl-auto').onclick = autoArrange;
        bar.querySelector('#pbl-cols').onchange = e => setCols(parseInt(e.target.value, 10) || getCols());
        updateStatus();
    }
    function updateStatus() {
        const el = document.getElementById('pbl-status');
        if (!el) return;
        let t = '', bad = false;
        if (status.local === 'ng') { t = '⚠️ この端末に保存できません'; bad = true; }
        else if (status.fb === 'saving') t = '💾 保存中…';
        else if (status.fb === 'ok') t = '💾 保存OK（この端末＋Firebase）';
        else if (status.fb && status.fb.indexOf('ng:') === 0) { t = '⚠️ Firebaseに保存できません：' + status.fb.slice(3) + '（この端末には保存済み）'; bad = true; }
        else if (status.fb === 'off') { t = '⚠️ Firebaseにつながっていません（この端末には保存済み）'; bad = true; }
        else if (status.fb === 'nocode') {
            const info = syncCodeInfo();
            const fileHint = (location.protocol === 'file:') ? ' ※file://で開いているため、ふだんのサイトとは別の保存領域です。サイトのURLから開いてね' : '';
            if (info.reason === 'format') { t = '⚠️ データ用コードの形式が想定外です（' + info.len + '文字）。Firebaseには保存しません' + fileHint; bad = true; }
            else t = 'ℹ️ この画面ではデータ用コードが見つかりません。Firebaseには保存しません（この端末・Driveには保存済み）' + fileHint;
        }
        el.textContent = t;
        el.classList.toggle('pbl-bad', bad);
    }
    function startEdit() {
        const s = document.getElementById('product-name-search');
        if (s && s.value.trim()) { toast('商品名の検索を空にしてから編集してね'); return; }
        editMode = true;
        buildToolbar();
        render();
    }
    function finishEdit() {
        editMode = false;
        commitAll();
        buildToolbar();
        render();
        try { if (typeof focusJanInput === 'function') focusJanInput(); } catch (e) { /* 無視 */ }
    }

    /* ---------- 商品の一覧（描画と共通） ---------- */
    function currentList() {
        let list = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
        const genre = (typeof selectedGenreFilter !== 'undefined') ? selectedGenreFilter : 'すべて';
        if (genre !== 'すべて') list = list.filter(p => (p.genre || 'その他商品') === genre);
        const sInput = document.getElementById('product-name-search');
        const searchTerm = sInput ? sInput.value.trim().toLowerCase() : '';
        if (searchTerm) list = list.filter(p => (p.name || '').toLowerCase().includes(searchTerm));
        list = list.slice().sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        return { list, genre, searchTerm };
    }
    function areaWidth() {
        const area = document.getElementById('custom-buttons-area');
        return Math.max((area && area.clientWidth) || 300, 150);
    }

    /* ---------- 配置の計算 ---------- */
    function defaultSize(W) {
        const cols = getCols();
        const w = Math.max(MIN_W, Math.floor((W - GAP * (cols + 1)) / cols));
        const side = Math.min(w, MAX_SIDE);   // 広い画面で大きくなりすぎないようにする
        // 余った幅は左右に分けて、中央に寄せる
        const off = Math.max(0, Math.floor((W - (side * cols + GAP * (cols + 1))) / 2));
        return { w: side, h: side, off };   // 正方形
    }
    function intersects(a, b) {
        return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
    }
    function savedToRect(s, W) {
        // fy が無いのは正方形にする前の古い配置なので使わない（重なるのを防ぐ）
        if (!s || !isFinite(s.fx) || !isFinite(s.fw) || !isFinite(s.fy)) return null;
        const w = clamp(Math.round(s.fw * W), MIN_W, W);   // 手で変えた大きさは、そのまま使う
        const x = clamp(Math.round(s.fx * W), 0, Math.max(0, W - w));
        return { x, y: Math.max(0, Math.round(s.fy * W)), w, h: w };
    }
    // saved=保存済みの配置。無いものは、初期の列数で左上から順に空きへ並べる
    function computeRects(list, saved, W, ignoreSaved) {
        const rects = {};
        const placed = [];
        const def = defaultSize(W);
        const pending = [];
        list.forEach(p => {
            const k = prodKey(p);
            const r = ignoreSaved ? null : savedToRect(saved[k], W);
            if (r) { rects[k] = r; placed.push(r); } else pending.push(k);
        });
        const left = GAP + def.off;
        let cx = left, cy = GAP, rowH = 0;
        pending.forEach(k => {
            const w = def.w, h = def.h;
            for (let guard = 0; guard < 5000; guard++) {
                if (cx + w > W - GAP - def.off + 1 && cx > left) { cx = left; cy += rowH + GAP; rowH = 0; }
                const test = { x: cx, y: cy, w, h };
                const hit = placed.find(r => intersects(test, r));
                if (hit) { cx = hit.x + hit.w + GAP; continue; }
                break;
            }
            const r = { x: cx, y: cy, w, h };
            rects[k] = r;
            placed.push(r);
            cx += w + GAP;
            rowH = Math.max(rowH, h);
        });
        return rects;
    }

    function toSaved(r, W) { return { fx: r4(r.x / W), fy: r4(r.y / W), fw: r4(r.w / W) }; }

    function commitAll() {
        if (!cur.gKey || !cur.W) return;
        const g = layoutObj.data[cur.gKey] = layoutObj.data[cur.gKey] || {};
        Object.keys(cur.rects).forEach(k => { g[k] = toSaved(cur.rects[k], cur.W); });
        scheduleSaveLayout();
    }

    // ✨ おまかせ配置：いまのタブを、横○列の見やすい並びに並べ直して保存
    function autoArrange() {
        const { list, genre, searchTerm } = currentList();
        if (searchTerm) { toast('商品名の検索を空にしてから、おまかせ配置してね'); return; }
        if (!list.length) { toast('このタブには商品がありません'); return; }
        const sel = document.getElementById('pbl-cols');
        if (sel) setCols(parseInt(sel.value, 10) || getCols());
        const doIt = () => {
            const W = areaWidth();
            const rects = computeRects(list, {}, W, true);
            const g = {};
            Object.keys(rects).forEach(k => { g[k] = toSaved(rects[k], W); });
            layoutObj.data[layoutKey(genre)] = g;
            scheduleSaveLayout();
            render();
            toast('✨ 横' + getCols() + '列で並べ直しました');
        };
        const hasSaved = Object.keys(layoutObj.data[layoutKey(genre)] || {}).length > 0;
        if (hasSaved && typeof showCustomConfirm === 'function') {
            showCustomConfirm('このタブのボタンを、横' + getCols() + '列の見やすい並びに並べ直しますか？（いまの配置は置きかわります。写真はそのまま残ります）', 'ならべなおし ます か？', res => { if (res) doIt(); }, true);
        } else if (hasSaved && typeof showCustomConfirm !== 'function') {
            if (window.confirm('このタブのボタンを並べ直しますか？（いまの配置は置きかわります）')) doIt();
        } else {
            doIt();
        }
    }

    /* ---------- 描画（generateCustomButtons の差し替え） ---------- */
    function styleBtn(btn, r) {
        btn.style.left = r.x + 'px';
        btn.style.top = r.y + 'px';
        btn.style.width = r.w + 'px';
        btn.style.height = r.h + 'px';
        const fs = Math.max(r.w < 90 ? 9 : 11, Math.min(22, Math.round(Math.min(r.w / 7.5, r.h / 3.4))));
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

        const { list, genre, searchTerm } = currentList();
        if (list.length === 0) {
            const msg = searchTerm ? `「${esc(searchTerm)}」に該当する商品はありません` : `「${esc(genre)}」に該当する商品はありません`;
            area.innerHTML = `<div style="text-align:center;color:#888;padding:20px;">${msg}</div>`;
            cur = { gKey: '', rects: {}, keys: {}, W: 0 };
            return;
        }

        const W = areaWidth();
        const gKey = layoutKey(genre);
        const saved = layoutObj.data[gKey] || {};
        const searching = !!searchTerm;
        const rects = computeRects(list, saved, W, searching);
        cur = { gKey: searching ? '' : gKey, rects, keys: {}, W };

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
            styleBtn(btn, r);

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
                            const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;   // 正方形のまま大きさを変える
                            nr.w = clamp(snap(start.r.w + d), 40, Math.max(40, cur.W - nr.x));
                            nr.h = nr.w;
                        } else {
                            nr.x = clamp(snap(start.r.x + dx), 0, Math.max(0, cur.W - nr.w));
                            nr.y = Math.max(0, snap(start.r.y + dy));
                        }
                        styleBtn(btn, nr);
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

    /* ---------- Google Driveバックアップ／ファイル保存への組み込み ---------- */
    // buildAllDataObject()（保存）と applyImportedDataObject()（復元）に、配置・写真を足す。
    // pos_ で始まるキーに入れないのは、他端末の同期で上書き・削除されるのを避けるため。
    function exportForBackup() {
        return { version: 4, layout: layoutObj, images: images, cols: readCols(LS_COLS, DEFAULT_COLS), colsSp: readCols(LS_COLS_SP, DEFAULT_COLS_SP) };
    }
    function importFromBackup(b) {
        if (!b || typeof b !== 'object') return;
        let changed = false;
        const L = b.layout;
        if (L && L.data && typeof L.data === 'object' && (Number(L.updatedAt) || 0) > layoutObj.updatedAt) {
            layoutObj = { updatedAt: Number(L.updatedAt) || 0, data: L.data };
            saveLayoutLocal();
            pushLayout();
            changed = true;
        }
        if (b.images && typeof b.images === 'object') {
            Object.keys(b.images).forEach(k => {
                const v = b.images[k];
                if (typeof v === 'string' && v.indexOf('data:image/') === 0 && images[k] !== v) {
                    images[k] = v;
                    pushImage(k, v);
                    changed = true;
                }
            });
            if (changed) saveImgCache();
        }
        if (b.version >= 4) {   // 古いバックアップの列数は使わない
            if (b.cols >= 1 && b.cols <= 10) writeCols(LS_COLS, b.cols);
            if (b.colsSp >= 1 && b.colsSp <= 10) writeCols(LS_COLS_SP, b.colsSp);
        }
        if (changed && registerActive() && !editMode) render();
    }
    function hookBackup(name, wrapFn) {
        (function tryHook(n) {
            const fn = window[name];
            if (typeof fn !== 'function') { if (n < 200) setTimeout(() => tryHook(n + 1), 300); return; }
            if (fn.__pblHooked) return;
            const wrapped = wrapFn(fn);
            wrapped.__pblHooked = true;
            window[name] = wrapped;
        })(0);
    }
    hookBackup('buildAllDataObject', original => function (...args) {
        const obj = original.apply(this, args);
        try { if (obj && typeof obj === 'object') obj.productButtonLayout = exportForBackup(); } catch (e) { /* 無視 */ }
        return obj;
    });
    hookBackup('applyImportedDataObject', original => function (dataObj, ...rest) {
        const result = original.call(this, dataObj, ...rest);
        try { if (dataObj && dataObj.productButtonLayout) importFromBackup(dataObj.productButtonLayout); } catch (e) { console.warn('商品ボタンの配置・写真の復元に失敗しました:', e); }
        return result;
    });

    /* ---------- 差し替え ---------- */
    window.generateCustomButtons = render;
    window.haruProductButtonLayout = { render, startEdit, finishEdit, autoArrange, exportForBackup, importFromBackup };

    // 画面の向き・大きさが変わったとき、割合で保存した配置を新しい幅に合わせて描き直す
    let rt = null;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => { if (registerActive() && !editMode && !dragging) { buildToolbar(); render(); } }, 350);
    });

    // 他の画面へ移るとき、編集モードは自動で終える
    setInterval(() => {
        if (editMode && !registerActive()) { editMode = false; commitAll(); buildToolbar(); }
    }, 1000);

    function boot() {
        ensureStyle();
        startFirebase(0);
        if (registerActive()) render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
