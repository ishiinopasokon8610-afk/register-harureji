// ==========================================
// migration-screen-readability-system.js
// 「データ管理・ロゴ設定」画面を、見やすく整える
//
//  ① 設定ブロックを「タイトルだけの行」にたたみ、押すと開く（開閉の状態は覚える）
//  ② 画面の上に「🔍 設定をさがす」欄と「すべて開く／すべて閉じる」ボタン（スクロールしても上に残る）
//  ③ 幅をそろえて中央に寄せ、文字・ボタン・入力欄を大きく、すき間を広く
//  ④ 色ぶんけ（各ブロックの色）はそのまま。危険な操作（初期化）は赤い枠で目立たせる
//
// ・index.html / 他のJSは変更しない。ブロックの中身は動かさず、CSSとクラスの追加だけ行う
//   （他のファイルが画面を作り直しても、1.5秒ごとに整え直す）。
// ・並び順は ui-compact-fixes-system.js のまま。
// ==========================================
(function migrationReadability() {
    'use strict';
    if (window.__migrationReadabilityInstalled) return;
    window.__migrationReadabilityInstalled = true;

    const LS_KEY = 'haru_migration_open_blocks_v1';   // 開いているブロックの名前（この端末だけ）
    let openSet = new Set();
    try { openSet = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch (e) { /* 無視 */ }
    function saveOpen() { try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(openSet))); } catch (e) { /* 無視 */ } }

    function screenEl() { return document.getElementById('migration-screen'); }

    /* ---------- CSS ---------- */
    function ensureStyle() {
        if (document.getElementById('mgr-read-style')) return;
        const st = document.createElement('style');
        st.id = 'mgr-read-style';
        st.textContent = `
        #migration-screen { font-size: 16px; }
        #migration-screen .mgr-wrap-ok > .migration-block,
        #migration-screen > .migration-block { max-width: 920px; margin: 0 auto 12px !important; padding: 0 !important; border-radius: 12px !important;
            overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.12); box-sizing: border-box; }
        #migration-screen > .migration-block > .mgr-title { margin: 0 !important; padding: 16px 48px 16px 18px !important; font-size: 18px !important; line-height: 1.4 !important;
            cursor: pointer; position: relative; user-select: none; -webkit-user-select: none; }
        #migration-screen > .migration-block > .mgr-title::after { content: '▾'; position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-size: 20px; transition: transform .15s; }
        #migration-screen > .migration-block.mgr-collapsed > .mgr-title::after { transform: translateY(-50%) rotate(-90deg); }
        #migration-screen > .migration-block > :not(.mgr-title) { margin-left: 18px !important; margin-right: 18px !important; max-width: calc(100% - 36px); box-sizing: border-box; }
        #migration-screen > .migration-block > :last-child { margin-bottom: 18px !important; }
        #migration-screen > .migration-block.mgr-collapsed > :not(.mgr-title) { display: none !important; }
        #migration-screen > .migration-block > p, #migration-screen > .migration-block .migration-desc { font-size: 14.5px !important; line-height: 1.75 !important; color: #444; }
        #migration-screen > .migration-block button { min-height: 40px; padding: 9px 16px !important; font-size: 15px !important; margin: 4px 8px 4px 0; border-radius: 8px !important; }
        #migration-screen > .migration-block input:not([type=checkbox]):not([type=radio]):not([type=file]), #migration-screen > .migration-block select { min-height: 40px; font-size: 16px; box-sizing: border-box; }
        #migration-screen > .migration-block.danger, #migration-screen > .migration-block.mgr-danger { border: 3px solid #e53935 !important; }
        #migration-screen > .migration-block.mgr-danger > .mgr-title::before { content: '⚠️ '; }
        #mgr-toolbar { position: sticky; top: 0; z-index: 30; max-width: 920px; margin: 0 auto 12px; padding: 10px 12px; box-sizing: border-box; display: flex; flex-wrap: wrap; gap: 8px;
            align-items: center; background: #fffde7; border: 2px solid #fbc02d; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
        #mgr-toolbar input { flex: 1 1 200px; min-width: 0; min-height: 40px; padding: 6px 12px; font-size: 16px; border: 1px solid #aaa; border-radius: 8px; box-sizing: border-box; }
        #mgr-toolbar button { min-height: 40px; padding: 8px 14px; font-size: 14px; font-weight: 700; border: none; border-radius: 8px; background: #546e7a; color: #fff; cursor: pointer; }
        #mgr-toolbar .mgr-count { font-size: 13px; color: #6d4c00; font-weight: 700; }
        #migration-screen > .migration-block.mgr-hidden { display: none !important; }
        @media (max-width: 700px) {
            #migration-screen > .migration-block > .mgr-title { font-size: 16px !important; padding: 14px 40px 14px 14px !important; }
            #migration-screen > .migration-block > :not(.mgr-title) { margin-left: 12px !important; margin-right: 12px !important; max-width: calc(100% - 24px); }
        }`;
        document.head.appendChild(st);
    }

    /* ---------- ブロックの準備 ---------- */
    function titleEl(b) {
        for (const c of b.children) {
            if (c.classList && c.classList.contains('mgr-title')) return c;
        }
        for (const c of b.children) {
            if (/^H[1-4]$/.test(c.tagName) || (c.classList && c.classList.contains('migration-title'))) return c;
        }
        return null;
    }
    function blockName(b) {
        const t = titleEl(b);
        return ((t ? t.textContent : b.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    function isDanger(b) {
        return b.classList.contains('danger') || /初期化|削除/.test(blockName(b));
    }
    function setCollapsed(b, collapsed) {
        b.classList.toggle('mgr-collapsed', collapsed);
        const name = blockName(b);
        if (collapsed) openSet.delete(name); else openSet.add(name);
    }

    function decorate(b) {
        if (b.dataset.mgrDone === '1') return;
        const t = titleEl(b);
        if (!t) return;                       // 見出しの無いブロックは、そのまま触らない
        b.dataset.mgrDone = '1';
        t.classList.add('mgr-title');
        if (isDanger(b)) b.classList.add('mgr-danger');
        t.setAttribute('role', 'button');
        t.setAttribute('tabindex', '0');
        t.addEventListener('click', () => { setCollapsed(b, !b.classList.contains('mgr-collapsed')); saveOpen(); });
        t.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); t.click(); }
        });
        // 前回開いていたものだけ開く。はじめては、すべて閉じておく
        b.classList.toggle('mgr-collapsed', !openSet.has(blockName(b)));
    }

    /* ---------- 検索・ツールバー ---------- */
    function ensureToolbar(scr) {
        let bar = document.getElementById('mgr-toolbar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'mgr-toolbar';
        bar.innerHTML =
            '<input type="search" id="mgr-search" placeholder="🔍 設定をさがす（例：バックアップ、ロゴ、税率）" autocomplete="off">' +
            '<button type="button" id="mgr-open-all">すべて開く</button>' +
            '<button type="button" id="mgr-close-all">すべて閉じる</button>' +
            '<span class="mgr-count" id="mgr-count"></span>';
        const top = scr.querySelector('.top-bar');
        if (top && top.parentNode === scr) top.insertAdjacentElement('afterend', bar); else scr.insertBefore(bar, scr.firstChild);

        const input = bar.querySelector('#mgr-search');
        input.addEventListener('input', applyFilter);
        input.addEventListener('keydown', e => { e.stopPropagation(); });   // スキャナ等の全体Enter処理に取られないように
        bar.querySelector('#mgr-open-all').addEventListener('click', () => {
            blocks(scr).forEach(b => setCollapsed(b, false)); saveOpen();
        });
        bar.querySelector('#mgr-close-all').addEventListener('click', () => {
            blocks(scr).forEach(b => setCollapsed(b, true)); saveOpen();
        });
        return bar;
    }
    function blocks(scr) {
        return Array.from(scr.children).filter(el => el.classList && el.classList.contains('migration-block') && el.classList.contains('mgr-title') === false && titleEl(el));
    }
    function applyFilter() {
        const scr = screenEl();
        if (!scr) return;
        const q = ((document.getElementById('mgr-search') || {}).value || '').trim().toLowerCase();
        let shown = 0;
        const list = blocks(scr);
        list.forEach(b => {
            const hit = !q || (b.textContent || '').toLowerCase().includes(q);
            b.classList.toggle('mgr-hidden', !hit);
            if (hit) shown++;
            // さがしているときは、見つかったブロックを開いて中身が見えるようにする（保存はしない）
            if (q && hit) b.classList.remove('mgr-collapsed');
        });
        const c = document.getElementById('mgr-count');
        if (c) c.textContent = q ? `${shown} / ${list.length} 件` : `${list.length} 件の設定`;
        if (!q) list.forEach(b => b.classList.toggle('mgr-collapsed', !openSet.has(blockName(b))));
    }

    /* ---------- 定期的に整える ---------- */
    function tick() {
        const scr = screenEl();
        if (!scr || !scr.classList.contains('active')) return;
        ensureStyle();
        Array.from(scr.children).forEach(el => {
            if (el.classList && el.classList.contains('migration-block')) decorate(el);
        });
        const bar = ensureToolbar(scr);
        const q = (document.getElementById('mgr-search') || {}).value || '';
        const c = document.getElementById('mgr-count');
        if (c && !q) c.textContent = `${blocks(scr).length} 件の設定`;
        // 他のファイルが後から足したブロックにも検索を効かせる
        if (q.trim()) applyFilter();
    }
    ensureStyle();
    setInterval(tick, 1500);
    if (window.MutationObserver) {
        // 【即時反映】画面が開かれた時・ブロックが増えた時は、描画の前に整える（待たせない）
        let q = false;
        let times = [];
        const root = document.getElementById('migration-screen') || document.body;
        new MutationObserver(() => {
            if (q) return; q = true;
            setTimeout(() => {
                q = false;
                const now = Date.now();
                times = times.filter(t => now - t < 2000);
                if (times.length >= 6) return;       // 他のJSと取り合いのときは、定期確認だけに任せる
                times.push(now);
                tick();
            }, 0);
        }).observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    setTimeout(tick, 300);
})();
