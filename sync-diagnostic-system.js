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
    const pings = []; // 受信した合図
    let timer = null;

    function ps() { return window.PosSync || null; }
    function j(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function ago(ms) { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + '秒前' : Math.round(s / 60) + '分前'; }

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
            '<button id="sync-diag-close" style="padding:10px 14px;border:0;border-radius:8px;background:#757575;color:#fff;">閉じる</button></div>' +
            '<pre id="sync-diag-text" style="white-space:pre-wrap;margin:0;"></pre>';
        document.body.appendChild(o);
        o.querySelector('#sync-diag-close').onclick = close;
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
})();
