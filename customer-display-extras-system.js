// ==========================================
// customer-display-extras-system.js
// 客用画面の追加機能
//  ① 画面の上の縁に「お知らせ」を流す（データ管理の「客用画面のお知らせ」で作る。スマホでも操作できる）
//  ② 会員の情報（会員番号・ポイント・失効予定・ランク）を、左下に小さく控えめに表示する
// 保存先：pos_customer_notices（pos_ で始まるので、設定の同期・バックアップに自動で含まれる）
// ==========================================
(function () {
    'use strict';
    const KEY = 'pos_customer_notices';

    const COLOR_KEY = 'pos_customer_notice_color';   // お知らせの文字の色（#rrggbb）。pos_ で始まるので同期・バックアップの対象
    const DEFAULT_COLOR = '#3e2723';
    function getColor() {
        try { const v = localStorage.getItem(COLOR_KEY); return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : DEFAULT_COLOR; } catch (e) { return DEFAULT_COLOR; }
    }
    const SCROLL_KEY = 'pos_customer_notice_scroll'; // 'false' なら流さず、固定で表示する
    function isScroll() { try { return localStorage.getItem(SCROLL_KEY) !== 'false'; } catch (e) { return true; } }
    let rotTimer = null, rotIdx = 0;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function load() {
        try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.text === 'string') : []; } catch (e) { return []; }
    }
    function save(list) {
        try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 無視 */ }
        try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) { /* 無視 */ }
        renderBanner();
        renderManager();
    }

    /* ---------- スタイル ---------- */
    function ensureStyle() {
        if (document.getElementById('customer-display-extras-style')) return;
        const st = document.createElement('style');
        st.id = 'customer-display-extras-style';
        st.textContent = `
        #customer-notice-bar { position: fixed; left: 0; right: 0; top: 6px; z-index: 50; height: 40px; overflow: hidden; display: none;
            background: rgba(255, 193, 7, 0.95); color: var(--cn-color, #3e2723); font-weight: 800; font-size: 20px; line-height: 40px; white-space: nowrap; pointer-events: none; }
        #customer-notice-bar .cn-track { display: inline-block; padding-left: 100%; animation: cn-scroll var(--cn-dur, 20s) linear infinite; }
        @keyframes cn-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }
        #customer-notice-bar.cn-static { text-align: center; padding: 0 12px; box-sizing: border-box; text-overflow: ellipsis; }
        #customer-screen.has-notice { padding-top: 46px !important; box-sizing: border-box; }
        /* 会員の情報：左下に小さく控えめに */
        #customer-member-card { display: none !important; }
        /* 下の金額バー（z-index:5500）の裏に隠れないよう、バーの高さぶん上げる（正確な位置は renderCorner で測り直す） */
        #customer-member-corner { position: fixed; left: 10px; bottom: calc(var(--customer-total-height, 110px) + 10px); z-index: 30; display: none; pointer-events: none;
            padding: 6px 10px; border-radius: 8px; background: rgba(0, 0, 0, 0.28); color: rgba(255, 255, 255, 0.72);
            font-size: 12px; line-height: 1.55; max-width: 60vw; }
        #customer-member-corner { text-align: left; }
        #customer-member-corner .cmc-l { display: block; }
        /* スマホ（横向き）など背の低い画面：横1行にまとめて小さくし、商品リストの枠のほうを上へ縮めて重ならないようにする */
        @media (max-height: 560px), (max-width: 700px) {
            #customer-member-corner { font-size: 11px; line-height: 1.4; padding: 3px 8px; max-width: calc(100vw - 20px); }
            #customer-member-corner .cmc-l { display: inline-block; margin-right: 12px; }
            #customer-member-corner .cmc-l:last-child { margin-right: 0; }
            #customer-screen.has-member-corner .customer-card { bottom: calc(var(--customer-total-height) + 20px + var(--cmc-extra, 0px)); }
        }
        #customer-member-corner .cmc-rank { display: inline-block; padding: 0 7px; border-radius: 8px; font-size: 11px; color: #fff; opacity: .85; }
        /* 右上の「クレジット／QR決済」「会員カード」のパネルが、お知らせの帯の裏に隠れないよう、帯の下へ */
        #customer-screen.has-notice .customer-side-panel { top: 56px; }
        @media (max-width: 600px) { #customer-screen.has-notice .customer-side-panel { top: 48px; } }
        /* データ管理：お知らせの設定（スマホ対応） */
        #customer-notice-block .cnb-color { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px; font-weight: 700; }
        #customer-notice-block .cnb-color input[type=color] { width: 56px; height: 38px; padding: 0; border: 1px solid #aaa; border-radius: 6px; background: #fff; cursor: pointer; }
        #customer-notice-block .cnb-color button { padding: 8px 14px; font-size: 14px; border: 1px solid #8d6e63; color: #5d4037; background: #fff; border-radius: 6px; cursor: pointer; }
        #customer-notice-block .cnb-color .cnb-sample { padding: 4px 14px; border-radius: 6px; background: rgba(255, 193, 7, 0.95); font-weight: 800; }
        #customer-notice-block .cnb-add { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        #customer-notice-block .cnb-add input { flex: 1 1 220px; min-width: 0; padding: 10px; font-size: 16px; border: 1px solid #aaa; border-radius: 6px; box-sizing: border-box; }
        #customer-notice-block .cnb-add button { flex: 0 0 auto; padding: 10px 16px; font-size: 15px; font-weight: 700; border: none; border-radius: 6px; background: #f9a825; color: #3e2723; cursor: pointer; }
        #customer-notice-block .cnb-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 0; border-top: 1px dashed #bbb; }
        #customer-notice-block .cnb-row label { display: flex; gap: 6px; align-items: center; font-weight: 700; flex: 0 0 auto; cursor: pointer; }
        #customer-notice-block .cnb-text { flex: 1 1 200px; min-width: 0; word-break: break-all; }
        #customer-notice-block .cnb-row button { padding: 6px 12px; font-size: 14px; border: 1px solid #c62828; color: #c62828; background: #fff; border-radius: 6px; cursor: pointer; }
        @media (max-width: 600px) { #customer-notice-bar { font-size: 16px; height: 34px; line-height: 34px; } #customer-screen.has-notice { padding-top: 40px !important; } }
        `;
        document.head.appendChild(st);
    }

    /* ---------- ① 客用画面の上のお知らせ ---------- */
    let lastBannerText = null;
    function renderBanner() {
        ensureStyle();
        const scr = document.getElementById('customer-screen');
        if (!scr) return;
        let bar = document.getElementById('customer-notice-bar');
        const texts = load().filter(n => n.on !== false && n.text.trim()).map(n => n.text.trim());
        if (!texts.length) {
            if (bar) bar.style.display = 'none';
            scr.classList.remove('has-notice');
            clearInterval(rotTimer); rotTimer = null;
            lastBannerText = null;
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'customer-notice-bar';
            bar.innerHTML = '<span class="cn-track"></span>';
            scr.appendChild(bar);
        }
        const scroll = isScroll();
        const joined = (scroll ? 'S:' : 'F:') + texts.join('\u0001');
        if (joined !== lastBannerText) {
            const track = bar.querySelector('.cn-track');
            clearInterval(rotTimer); rotTimer = null; rotIdx = 0;
            track.style.animation = 'none';
            if (scroll) {
                bar.classList.remove('cn-static');
                track.style.paddingLeft = '';
                track.textContent = texts.join('　　　◆　　　');
                const len = track.textContent.length;
                // 文字数に合わせて速さを決める（読みやすいように、ゆっくりめ）
                track.style.setProperty('--cn-dur', Math.max(14, Math.round(len * 0.45 + 10)) + 's');
                void track.offsetWidth; track.style.animation = '';
            } else {
                // 流さずに固定で表示。複数あるときは、数秒ごとに切り替える
                bar.classList.add('cn-static');
                track.style.paddingLeft = '0';
                track.style.animation = 'none';
                track.textContent = texts[0];
                if (texts.length > 1) {
                    rotTimer = setInterval(() => { rotIdx = (rotIdx + 1) % texts.length; track.textContent = texts[rotIdx]; }, 6000);
                }
            }
            lastBannerText = joined;
        }
        bar.style.setProperty('--cn-color', getColor());
        bar.style.display = 'block';
        scr.classList.add('has-notice');
    }

    /* ---------- データ管理：お知らせを作る画面 ---------- */
    function renderManager() {
        const b = document.getElementById('customer-notice-block');
        if (!b) return;
        const list = load();
        const box = b.querySelector('.cnb-list');
        box.innerHTML = list.length ? '' : '<div style="color:#777;font-size:13px;padding:6px 0;">お知らせはまだありません。</div>';
        list.forEach((n, i) => {
            const row = document.createElement('div');
            row.className = 'cnb-row';
            row.innerHTML = `<label><input type="checkbox" ${n.on !== false ? 'checked' : ''} style="width:20px;height:20px"> 表示</label><span class="cnb-text">${esc(n.text)}</span><button type="button">削除</button>`;
            row.querySelector('input').addEventListener('change', (e) => { const l = load(); if (l[i]) { l[i].on = e.target.checked; save(l); } });
            row.querySelector('button').addEventListener('click', () => { const l = load(); l.splice(i, 1); save(l); });
            box.appendChild(row);
        });
    }
    function ensureManagerBlock() {
        const scr = document.getElementById('migration-screen');
        if (!scr || document.getElementById('customer-notice-block')) return;
        ensureStyle();
        const b = document.createElement('div');
        b.id = 'customer-notice-block';
        b.className = 'migration-block';
        b.style.cssText = 'background:#fffde7;border:2px solid #ffd54f;padding:15px;border-radius:6px;margin-bottom:15px';
        b.innerHTML = '<h3 class="migration-title" style="color:#f57f17">📢 客用画面のお知らせ</h3>' +
            '<p class="migration-desc">客用画面の一番上に、文字が流れて表示されます。複数あるときは、つなげて流れます。</p>' +
            '<label style="display:flex;gap:8px;align-items:center;font-weight:700;cursor:pointer;margin-top:8px"><input type="checkbox" id="cnb-scroll" style="width:20px;height:20px"> 文字を流す（OFFにすると、固定で表示します）</label>' +
            '<div class="cnb-color"><span>文字の色</span><input type="color" id="cnb-color"><span class="cnb-sample" id="cnb-sample">見本：本日もありがとうございます</span><button type="button" id="cnb-color-reset">元の色に戻す</button></div>' +
            '<div class="cnb-add"><input type="text" id="cnb-input" maxlength="120" placeholder="例：本日はポイント2倍デーです"><button type="button" id="cnb-add-btn">追加</button></div>' +
            '<div class="cnb-list" style="margin-top:10px"></div>';
        const first = scr.querySelector('.migration-block');
        if (first && first.parentNode === scr) scr.insertBefore(b, first); else scr.appendChild(b);
        const add = () => {
            const inp = b.querySelector('#cnb-input');
            const t = inp.value.trim();
            if (!t) return;
            const l = load(); l.push({ text: t, on: true }); inp.value = '';
            save(l);
            if (typeof playSound === 'function') playSound('click');
        };
        b.querySelector('#cnb-add-btn').addEventListener('click', add);
        b.querySelector('#cnb-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); add(); } });
        const sc = b.querySelector('#cnb-scroll');
        sc.checked = isScroll();
        sc.addEventListener('change', () => {
            try { localStorage.setItem(SCROLL_KEY, sc.checked ? 'true' : 'false'); } catch (e) { /* 無視 */ }
            try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) { /* 無視 */ }
            renderBanner();
            if (typeof playSound === 'function') playSound('click');
        });
        const col = b.querySelector('#cnb-color'), sample = b.querySelector('#cnb-sample');
        const showColor = () => { const c = getColor(); col.value = c; sample.style.color = c; };
        showColor();
        // 色を選んでいる間も、客用画面にすぐ反映する（保存・バックアップは選び終わったときに1回だけ）
        col.addEventListener('input', () => {
            try { localStorage.setItem(COLOR_KEY, col.value); } catch (e) { /* 無視 */ }
            sample.style.color = col.value;
            renderBanner();
        });
        col.addEventListener('change', () => {
            try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) { /* 無視 */ }
        });
        b.querySelector('#cnb-color-reset').addEventListener('click', () => {
            try { localStorage.removeItem(COLOR_KEY); } catch (e) { /* 無視 */ }
            try { if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow(); } catch (e) { /* 無視 */ }
            showColor(); renderBanner();
            if (typeof playSound === 'function') playSound('click');
        });
        renderManager();
    }

    /* ---------- ② 左下の会員情報 ---------- */
    function expiryTextFor(cust) {
        try {
            if (typeof checkPointExpiry !== 'function' || !cust) return '';
            if (!(Number(cust.points) > 0)) return '';
            const exp = checkPointExpiry(cust) || {};
            if (exp.expired) return '失効しました';
            if (typeof exp.daysLeft === 'number') {
                const d = new Date(Date.now() + exp.daysLeft * 86400000);
                return `${d.getMonth() + 1}/${d.getDate()}（あと${exp.daysLeft}日）`;
            }
        } catch (e) { /* 無視 */ }
        return '';
    }
    function hookSummary() {
        if (typeof window.buildMemberSummary !== 'function') { setTimeout(hookSummary, 300); return; }
        if (window.buildMemberSummary.__cdx) return;
        const orig = window.buildMemberSummary;
        window.buildMemberSummary = function (cust) {
            const r = orig.apply(this, arguments);
            if (r && cust) {
                r.barcode = cust.barcode || '';
                r.expiryText = expiryTextFor(cust);
            }
            return r;
        };
        window.buildMemberSummary.__cdx = true;
    }
    function renderCorner() {
        const scr = document.getElementById('customer-screen');
        if (!scr) return;
        ensureStyle();
        let el = document.getElementById('customer-member-corner');
        const info = (typeof customerDisplayMemberInfo !== 'undefined') ? customerDisplayMemberInfo : null;
        if (!info) { if (el) el.style.display = 'none'; scr.classList.remove('has-member-corner'); return; }
        if (!el) { el = document.createElement('div'); el.id = 'customer-member-corner'; scr.appendChild(el); }
        const pts = (info.points !== undefined && info.points !== null) ? info.points : 0;
        const rank = info.rankName ? `<span class="cmc-rank" style="background:${esc(info.rankColor || '#607d8b')}">${esc(info.rankName)}</span>` : '';
        const lines = [];
        if (info.barcode) lines.push(`会員番号 ${esc(info.barcode)}`);
        lines.push(`ポイント ${esc(pts)} pt`);
        lines.push(`失効予定 ${info.expiryText ? esc(info.expiryText) : 'なし'}`);
        if (rank) lines.push(`ランク ${rank}`);
        el.innerHTML = lines.map(l => '<span class="cmc-l">' + l + '</span>').join('');
        el.style.display = 'block';
        scr.classList.add('has-member-corner');
        placeCorner(el);
    }
    const COMPACT_MQ = '(max-height: 560px), (max-width: 700px)';
    // 金額バーのすぐ上に置く（バーの高さが変わっても追従する）
    function placeCorner(el) {
        try {
            const scr = document.getElementById('customer-screen');
            const compact = !!(window.matchMedia && window.matchMedia(COMPACT_MQ).matches);
            const gap = compact ? 6 : 10;
            const bar = document.querySelector('#customer-screen .customer-total-area');
            if (bar && bar.getClientRects().length) {
                el.style.bottom = Math.round(window.innerHeight - bar.getBoundingClientRect().top + gap) + 'px';
            }
            // コンパクト表示のときだけ：会員情報が商品リストの枠にかかる分だけ、枠の下端を上げる
            const card = scr && scr.querySelector('.customer-card');
            if (!scr || !card) return;
            const cur = Number(scr.dataset.cmcExtra || 0);
            let need = 0;
            if (compact) {
                const naturalBottom = card.getBoundingClientRect().bottom + cur;   // 押し上げる前の下端
                need = Math.max(0, Math.round(naturalBottom - (el.getBoundingClientRect().top - 6)));
            }
            if (need !== cur) {
                scr.dataset.cmcExtra = String(need);
                scr.style.setProperty('--cmc-extra', need + 'px');
            }
        } catch (e) { /* 無視 */ }
    }
    function hookDisplay() {
        if (typeof window.updateCustomerDisplay !== 'function') { setTimeout(hookDisplay, 300); return; }
        if (window.updateCustomerDisplay.__cdx) return;
        const orig = window.updateCustomerDisplay;
        window.updateCustomerDisplay = function () {
            const r = orig.apply(this, arguments);
            try { renderCorner(); renderBanner(); } catch (e) { console.warn('客用画面の追加表示でエラー', e); }
            return r;
        };
        window.updateCustomerDisplay.__cdx = true;
    }

    function refreshAll() {
        renderBanner(); renderManager();
        const c = document.getElementById('cnb-scroll'); if (c) c.checked = isScroll();
        const cc = document.getElementById('cnb-color'); if (cc) cc.value = getColor();
        const sm = document.getElementById('cnb-sample'); if (sm) sm.style.color = getColor();
    }
    window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === SCROLL_KEY || e.key === COLOR_KEY) refreshAll(); });
    window.addEventListener('pos-setting-synced', (e) => { if (e && e.detail && (e.detail.key === KEY || e.detail.key === SCROLL_KEY || e.detail.key === COLOR_KEY)) refreshAll(); });
    window.addEventListener('resize', () => { const el = document.getElementById('customer-member-corner'); if (el && el.style.display !== 'none') placeCorner(el); });
    hookSummary();
    hookDisplay();
    setInterval(() => { try { ensureManagerBlock(); renderBanner(); renderCorner(); } catch (e) { /* 無視 */ } }, 1500);
})();
