// ==========================================
// sync-diagnostic-system.js
// ------------------------------------------
// 同期の状態を、スマホでもコンソール無しで確認するための画面（調査用）。
// URLの末尾に #diag を付けて開く（例: .../register-harureji/#diag）。または画面を開いた状態で
// アドレスを #diag に変える。右上の「閉じる」で閉じる。
// 「📡 通信テスト」を押すと、同じデータ用コードの他の端末に合図を送り、
// 他の端末から届いた合図を「受信」に表示する（端末どうしの通信ができているかの確認）。
// 何も変更しない（読むだけ・合図を送るだけ）。index.html の一番最後に読み込む。
// ==========================================
(function syncDiagnostic() {
    'use strict';
    // ===== エラーの記録（このファイルを一番最初に読み込むので、あとで起きたエラーはすべてここに残る） =====
    const ERR_KEY = 'pos_sync_diag_errors'; // pos_sync_ で始まる＝他端末には同期されない
    const errs = (function () { try { const v = JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } })();
    let errSaveT = null;
    function saveErrs() {
        if (errSaveT) return;
        errSaveT = setTimeout(() => { errSaveT = null; try { localStorage.setItem(ERR_KEY, JSON.stringify(errs.slice(-80))); } catch (e) { /* 無視 */ } }, 500);
    }
    function strOf(x) {
        try {
            if (x instanceof Error) return (x.name + ': ' + x.message);
            if (typeof x === 'string') return x;
            return JSON.stringify(x);
        } catch (e) { return String(x); }
    }
    function addErr(kind, msg, where) {
        const m = String(msg || '').slice(0, 300);
        const last = errs[errs.length - 1];
        if (last && last.k === kind && last.m === m && last.w === (where || '')) { last.n = (last.n || 1) + 1; last.t = Date.now(); saveErrs(); return; }
        errs.push({ t: Date.now(), k: kind, m: m, w: where || '', n: 1, v: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '') });
        if (errs.length > 120) errs.shift();
        saveErrs();
    }
    window.addEventListener('error', (e) => {
        const t = e && e.target;
        if (t && t !== window && (t.src || t.href)) { addErr('読み込み失敗', (t.tagName || '') + ' ' + (t.src || t.href), ''); return; }
        addErr('JSエラー', (e && e.message) || strOf(e && e.error), ((e && e.filename) || '').split('/').pop() + ':' + (e && e.lineno) + ':' + (e && e.colno));
    }, true);
    window.addEventListener('unhandledrejection', (e) => { addErr('Promise失敗', strOf(e && e.reason), ''); });
    ['error', 'warn'].forEach((lv) => {
        const orig = console[lv];
        console[lv] = function () {
            try { addErr(lv === 'error' ? 'console.error' : 'console.warn', Array.prototype.map.call(arguments, strOf).join(' '), ''); } catch (e) { /* 無視 */ }
            return orig.apply(this, arguments);
        };
    });
    const pings = []; // 受信した合図
    let timer = null;

    function ps() { return window.PosSync || null; }
    function j(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function ago(ms) { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + '秒前' : Math.round(s / 60) + '分前'; }

    let swInfo = '';
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(r => { swInfo = '登録' + r.length + '件'; }).catch(() => {});
            if (window.caches) caches.keys().then(k => { swInfo += ' / キャッシュ: ' + (k.join(',') || 'なし'); }).catch(() => {});
        }
    } catch (e) { /* 無視 */ }

    function subscribePing() {
        if (typeof channel === 'undefined' || !channel || typeof channel.subscribe !== 'function') { setTimeout(subscribePing, 700); return; }
        channel.subscribe('diag-ping', (m) => {
            const d = (m && m.data) || {};
            if (m && m.own) return;
            pings.unshift({ at: Date.now(), from: d.label || '?', sent: d.t });
            if (pings.length > 8) pings.pop();
            render();
        });
    }
    subscribePing();

    function lines() {
        const L = [];
        const P = ps();
        L.push('【開いている場所】' + location.protocol + '//' + (location.host || '(file)') + location.pathname);
        if (location.protocol === 'file:') L.push('⚠ ファイルを直接開いています。GitHub PagesのURLで開いてください');
        L.push('【版】order:' + (typeof isFreshOrderMessage === 'function' ? '新' : '古い') +
            ' / discount:' + (typeof discStateApi === 'function' ? '新' : '古い') +
            ' / 画面取込:' + (typeof discReloadFromStorage === 'function' ? 'あり' : 'なし'));
        L.push('【同期】状態:' + (P ? P.getStatus() : 'なし') + ' / 接続中の端末数:' + (P ? P.getDeviceCount() : '-') +
            ' / コード:' + (P && P.getCode() ? 'あり' : 'なし'));
        const seen = j('pos_sync_last_seen');
        if (seen) { const k = Object.keys(seen)[0]; if (k && seen[k]) L.push('最後に受信したイベント: ' + ago(seen[k].t)); }
        if (P && P.getStats) { const s = P.getStats(); L.push('送信:' + s.sent + ' 受信:' + s.received + ' 遅れ平均:' + s.recentLagAvgMs + 'ms'); }
        // 注文カード
        const q = j('pos_last_order_display');
        const arr = Array.isArray(q) ? q : (q ? [q] : []);
        L.push('【注文カード】この端末の件数:' + arr.length + ' / 使う設定:' + (typeof isUseOrderSystemEnabled === 'function' ? isUseOrderSystemEnabled() : '?'));
        arr.slice(0, 5).forEach(r => L.push('  ・…' + String(r.orderId || '').slice(-6) + ' チェック' + ((r.checkedItems || []).filter(Boolean).length) + '/' + ((r.cartSnapshot || []).length)));
        const rm = j('pos_sync_order_removed') || {};
        L.push('消した印の件数:' + Object.keys(rm).length);
        // 自動化バーコード
        const mem = (typeof discountBarcodes !== 'undefined' && Array.isArray(discountBarcodes)) ? discountBarcodes : [];
        const ls = j('pos_discounts') || [];
        const shown = mem.filter(d => !d.archived && !d.hideFromHome);
        L.push('【自動化バーコード】画面用:' + mem.length + ' / 保存:' + ls.length + ' / ホームに出る:' + shown.length);
        const tbl = mem.filter(d => /^TBL/.test(d.barcode || ''));
        L.push('  TBL(タッチパネル注文): ' + tbl.length + '件（非表示' + tbl.filter(d => d.hideFromHome).length + ' / 使用済み' + tbl.filter(d => d.archived).length + '）');
        const slf = mem.filter(d => /^SELF/.test(d.barcode || ''));
        L.push('  SELF(セルフレジ): ' + slf.length + '件（非表示' + slf.filter(d => d.hideFromHome).length + ' / 使用済み' + slf.filter(d => d.archived).length + '）');
        L.push('【通信テストの受信】' + (pings.length ? '' : 'まだ届いていません'));
        pings.forEach(p => L.push('  ・' + p.from + ' から ' + ago(p.at)));
        // ===== エラー・環境のチェック =====
        L.push('');
        L.push('━━ エラー（新しい順・最大30件／計' + errs.length + '件） ━━');
        if (!errs.length) L.push('エラーは記録されていません');
        errs.slice(-30).reverse().forEach(x => {
            const d = new Date(x.t);
            const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
            L.push('[' + hh + '] ' + x.k + (x.n > 1 ? ' ×' + x.n : '') + (x.v ? ' (' + x.v + ')' : ''));
            L.push('   ' + x.m + (x.w ? '  @' + x.w : ''));
        });
        L.push('');
        L.push('━━ 環境チェック ━━');
        L.push('アプリの版: ' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '不明（update-notification-system.js が読み込めていません）'));
        L.push('通信: ' + (navigator.onLine ? 'オンライン' : '⚠ オフライン') + ' / https: ' + (location.protocol === 'https:' ? 'OK' : '⚠ ' + location.protocol) + ' / 暗号機能: ' + ((window.crypto && window.crypto.subtle) ? 'OK' : '⚠ 使えません'));
        L.push('Firebase SDK: ' + (typeof firebase !== 'undefined' ? (typeof firebase.database === 'function' ? 'OK(database)' : '⚠ databaseが無い') : '⚠ 読み込めていません'));
        L.push('同期の入れ物 channel: ' + ((typeof channel !== 'undefined' && channel && channel.__isPosSyncChannel) ? 'OK' : '⚠ 未接続'));
        L.push('Service Worker: ' + ('serviceWorker' in navigator ? (navigator.serviceWorker.controller ? '動作中' : '未制御（初回/未登録）') : '非対応') + (swInfo ? ' / ' + swInfo : ''));
        L.push('通知: ' + (typeof Notification === 'undefined' ? '非対応' : Notification.permission) + ' / 設定: ' + localStorage.getItem('pos_notif_enabled'));
        try {
            let bytes = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); bytes += k.length + (localStorage.getItem(k) || '').length; }
            L.push('保存データ量: 約' + Math.round(bytes / 1024) + 'KB（上限は目安5000KB）' + (bytes > 4200 * 1024 ? ' ⚠ いっぱいに近い' : ''));
        } catch (e) { L.push('保存データ量: 調べられません'); }
        const need = ['completeTransaction', 'checkAndAddToCart', 'renderHomeAutomationBlocksGrid', 'discMergeRemote', 'speak', 'playSound', 'showScreen', 'addDiscountBarcode'];
        const miss = need.filter(n => typeof window[n] !== 'function');
        L.push('必要な関数: ' + (miss.length ? '⚠ 足りない→ ' + miss.join(', ') : 'すべてあります'));
        if (P && P.getCode && !P.getCode()) L.push('⚠ データ用コードが未設定です（同期しません）');
        const seen2 = j('pos_sync_last_seen');
        if (seen2) { const k2 = Object.keys(seen2)[0]; if (k2 && seen2[k2] && seen2[k2].t > Date.now() + 5 * 60 * 1000) L.push('⚠ 最後に受信した時刻が未来になっています（+' + Math.round((seen2[k2].t - Date.now()) / 60000) + '分）。端末の時計のずれ？'); }
        return L;
    }

    function ensure() {
        let o = document.getElementById('sync-diag-overlay');
        if (o) return o;
        o = document.createElement('div');
        o.id = 'sync-diag-overlay';
        o.style.cssText = 'position:fixed;inset:0;z-index:100090;background:#111;color:#eee;padding:12px;box-sizing:border-box;overflow:auto;font:13px/1.6 monospace;';
        o.innerHTML = '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">' +
            '<button id="sync-diag-ping" style="padding:10px 14px;border:0;border-radius:8px;background:#1976d2;color:#fff;font-weight:bold;">📡 通信テスト</button>' +
            '<button id="sync-diag-copy" style="padding:10px 14px;border:0;border-radius:8px;background:#2e7d32;color:#fff;">📋 コピー</button>' +
            '<button id="sync-diag-clear" style="padding:10px 14px;border:0;border-radius:8px;background:#ef6c00;color:#fff;">🧹 エラー消去</button>' +
            '<button id="sync-diag-close" style="padding:10px 14px;border:0;border-radius:8px;background:#757575;color:#fff;">閉じる</button></div>' +
            '<pre id="sync-diag-text" style="white-space:pre-wrap;margin:0;"></pre>';
        document.body.appendChild(o);
        o.querySelector('#sync-diag-close').onclick = close;
        o.querySelector('#sync-diag-clear').onclick = () => { errs.length = 0; try { localStorage.removeItem(ERR_KEY); } catch (e) { /* 無視 */ } render(); };
        o.querySelector('#sync-diag-copy').onclick = () => {
            const text = lines().join('\n');
            const done = () => { const b = o.querySelector('#sync-diag-copy'); b.textContent = '✅ コピーしました'; setTimeout(() => { b.textContent = '📋 コピー'; }, 1500); };
            try { navigator.clipboard.writeText(text).then(done, () => { prompt('コピーしてください', text); }); } catch (e) { prompt('コピーしてください', text); }
        };
        o.querySelector('#sync-diag-ping').onclick = () => {
            try {
                const label = (ps() && ps().DEVICE_TAG ? ps().DEVICE_TAG.slice(-4) : '') + ' (' + (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'スマホ' : 'PC') + ')';
                if (typeof channel !== 'undefined' && channel) channel.publish('diag-ping', { label: label, t: Date.now() });
                pings.unshift({ at: Date.now(), from: '（自分が送信）', sent: Date.now() }); render();
            } catch (e) { alert('送信できませんでした: ' + e.message); }
        };
        return o;
    }

    function render() {
        const o = document.getElementById('sync-diag-overlay');
        if (!o) return;
        const pre = o.querySelector('#sync-diag-text');
        if (pre) pre.textContent = lines().join('\n');
    }

    function open() { ensure(); render(); if (!timer) timer = setInterval(render, 2000); }
    function close() {
        const o = document.getElementById('sync-diag-overlay');
        if (o) o.remove();
        if (timer) { clearInterval(timer); timer = null; }
        if (location.hash === '#diag') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 無視 */ } }
    }

    function check() { if (location.hash === '#diag') open(); }
    window.addEventListener('hashchange', check);
    window.addEventListener('load', () => setTimeout(check, 800));
    window.openSyncDiag = open;

    // 分析画面を開いている間、画面（指でもマウスでも）を16秒長押しすると診断画面を開く（#diag でも開ける）
    (function () {
        let t = null, sx = 0, sy = 0;
        const stop = () => { if (t) { clearTimeout(t); t = null; } };
        const visible = () => { const a = document.getElementById('analytics-screen'); return !!(a && a.offsetParent !== null && getComputedStyle(a).display !== 'none'); };
        const begin = (e, x, y) => {
            stop();
            if (!visible() || !e.target || !e.target.closest || !e.target.closest('#analytics-screen')) return;
            sx = x; sy = y;
            t = setTimeout(() => { t = null; if (visible()) open(); }, 16000);
        };
        const move = (x, y) => { if (t && Math.hypot(x - sx, y - sy) > 25) stop(); };
        document.addEventListener('pointerdown', (e) => begin(e, e.clientX, e.clientY), true);
        document.addEventListener('mousedown', (e) => { if (e.button === 0) begin(e, e.clientX, e.clientY); }, true);
        document.addEventListener('touchstart', (e) => { const c = e.touches && e.touches[0]; if (c) begin(e, c.clientX, c.clientY); }, true);
        document.addEventListener('pointermove', (e) => move(e.clientX, e.clientY), true);
        document.addEventListener('mousemove', (e) => move(e.clientX, e.clientY), true);
        document.addEventListener('touchmove', (e) => { const c = e.touches && e.touches[0]; if (c) move(c.clientX, c.clientY); }, true);
        ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel', 'dragstart', 'contextmenu'].forEach(n => document.addEventListener(n, stop, true));
    })();
})();
