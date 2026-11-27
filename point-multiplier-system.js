// ==========================================
// point-multiplier-system.js
// ポイント倍率（「ポイント2倍デー」など）を、データ管理で設定できるようにする。
// 設定は pos_point_multiplier（pos_ で始まるので、設定の同期・バックアップに自動で入る）
//   { on: true/false, mult: 2, from: 'YYYY-MM-DD' or '', to: 'YYYY-MM-DD' or '' }
// 会計でもらえるポイント（rank に応じた還元率）に、この倍率をかける。
// 期間（開始日・終了日）は空ならずっと有効。終了日は、その日の終わりまで。
// ==========================================
(function () {
    'use strict';
    const KEY = 'pos_point_multiplier';

    function load() {
        try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function todayStr() {
        const d = new Date(); const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    // いま有効な倍率（無効なら 1）
    function currentMultiplier() {
        const o = load();
        if (!o.on) return 1;
        const m = Number(o.mult);
        if (!(m > 0)) return 1;
        const t = todayStr();
        if (o.from && t < o.from) return 1;
        if (o.to && t > o.to) return 1;
        return m;
    }
    window.getPointMultiplierNow = currentMultiplier;

    function save(o) {
        try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 無視 */ }
        try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) { /* 無視 */ }
    }

    // 会計のポイント付与率に倍率をかける
    function hook() {
        if (typeof window.addPurchaseAndGetRewardRate !== 'function') { setTimeout(hook, 300); return; }
        if (window.addPurchaseAndGetRewardRate.__pm) return;
        const orig = window.addPurchaseAndGetRewardRate;
        window.addPurchaseAndGetRewardRate = function () {
            const rate = orig.apply(this, arguments);
            const m = currentMultiplier();
            return (typeof rate === 'number') ? rate * m : rate;
        };
        window.addPurchaseAndGetRewardRate.__pm = true;
    }
    hook();

    /* ---------- データ管理の設定ブロック ---------- */
    function ensureBlock() {
        const scr = document.getElementById('migration-screen');
        if (!scr || document.getElementById('point-multiplier-block')) return;
        const o = load();
        const b = document.createElement('div');
        b.id = 'point-multiplier-block';
        b.className = 'migration-block';
        b.style.cssText = 'background:#fce4ec;border:2px solid #f48fb1;padding:15px;border-radius:6px;margin-bottom:15px';
        b.innerHTML = '<h3 class="migration-title" style="color:#c2185b">✨ ポイント倍率（ポイント2倍デーなど）</h3>' +
            '<p class="migration-desc">ONにすると、会計でもらえるポイントが、ランクごとの還元率の「倍率」ぶん増えます。期間を入れると、その間だけ有効です（空ならずっと）。</p>' +
            '<label style="display:flex;gap:8px;align-items:center;font-weight:700;cursor:pointer"><input type="checkbox" id="pm-on" style="width:20px;height:20px"> ポイント倍率を適用する</label>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px">' +
            '<label style="font-weight:700">倍率 <input type="number" id="pm-mult" min="0.5" max="10" step="0.5" style="width:80px;padding:8px;font-size:16px;box-sizing:border-box"> 倍</label>' +
            '<label style="font-weight:700">開始日 <input type="date" id="pm-from" style="padding:8px;font-size:16px;box-sizing:border-box"></label>' +
            '<label style="font-weight:700">終了日 <input type="date" id="pm-to" style="padding:8px;font-size:16px;box-sizing:border-box"></label>' +
            '</div><div id="pm-status" style="margin-top:8px;font-size:13px;color:#880e4f"></div>';
        const first = scr.querySelector('.migration-block');
        if (first && first.parentNode === scr) scr.insertBefore(b, first); else scr.appendChild(b);
        const on = b.querySelector('#pm-on'), mult = b.querySelector('#pm-mult'), from = b.querySelector('#pm-from'), to = b.querySelector('#pm-to');
        const status = b.querySelector('#pm-status');
        const fill = () => {
            const s = load();
            on.checked = !!s.on; mult.value = s.mult || 2; from.value = s.from || ''; to.value = s.to || '';
            const m = currentMultiplier();
            status.textContent = m !== 1 ? `いま：ポイント ${m} 倍 が有効です` : 'いま：倍率は有効ではありません';
        };
        const commit = () => {
            const s = { on: on.checked, mult: Number(mult.value) > 0 ? Number(mult.value) : 2, from: from.value || '', to: to.value || '' };
            save(s); fill();
            if (typeof playSound === 'function') playSound('click');
        };
        [on, mult, from, to].forEach(el => el.addEventListener('change', commit));
        fill();
        b._fill = fill;
    }
    function refresh() { const b = document.getElementById('point-multiplier-block'); if (b && b._fill) b._fill(); }
    window.addEventListener('storage', (e) => { if (e.key === KEY) refresh(); });
    window.addEventListener('pos-setting-synced', (e) => { if (e && e.detail && e.detail.key === KEY) refresh(); });
    setInterval(ensureBlock, 1500);
})();
