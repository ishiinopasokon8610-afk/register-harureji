// ==========================================
// migration-screen-readability-system.js
// 「データ管理・ロゴ設定」画面を、すっきり見せる
//
//  ・画面を開くたびに、設定ブロックはぜんぶ「タイトルだけ」に閉じた状態から始まる
//  ・タイトルを押すと、そのブロックだけ開く／もう一度押すと閉じる
//  ・ブロックが縦に押しつぶされて文字が欠ける問題（flexの縮み）を防ぐ
//  ・左のサイドバーの項目を選ぶと、そのブロックが開いて、そこへ移動する
//  ・検索バーなどは付けない
//
// ・index.html / 他のJSは変更しない（CSSとクラスの追加だけ）。
// ・他のJSとの取り合いで固まらないよう、画面の中身を並べ替えたり移動したりはしない。
// ==========================================
(function migrationReadability() {
    'use strict';
    if (window.__migrationReadabilityInstalled) return;
    window.__migrationReadabilityInstalled = true;

    function screenEl() { return document.getElementById('migration-screen'); }

    /* ---------- CSS ---------- */
    function ensureStyle() {
        if (document.getElementById('mgr-read-style')) return;
        const st = document.createElement('style');
        st.id = 'mgr-read-style';
        st.textContent = `
        /* ブロックが縮んで文字が切れないようにする（親がflexでも、高さは中身にあわせる） */
        #migration-screen .mgr-block { flex: 0 0 auto !important; height: auto !important; min-height: 0 !important; max-height: none !important;
            overflow: visible !important; box-sizing: border-box; margin-bottom: 12px !important; border-radius: 10px; }
        #migration-screen .mgr-block .mgr-title { display: block; cursor: pointer; position: relative; user-select: none; -webkit-user-select: none;
            padding-right: 34px !important; line-height: 1.45 !important; font-size: 18px !important; height: auto !important; overflow: visible !important; }
        #migration-screen .mgr-block .mgr-title::after { content: '▾'; position: absolute; right: 6px; top: 50%; transform: translateY(-50%); font-size: 18px; opacity: .6; transition: transform .15s; }
        #migration-screen .mgr-block.mgr-collapsed .mgr-title::after { transform: translateY(-50%) rotate(-90deg); }
        #migration-screen .mgr-block.mgr-collapsed .mgr-title { margin-bottom: 0 !important; }
        /* いちばん下のほうのブロックも画面の上まで送れるように、下に余白を足す（サイドバーの青い項目がずれないように） */
        #migration-screen.active::after { content: ''; display: block; flex: 0 0 auto; height: 85vh; }
        #migration-screen .mgr-block { scroll-margin-top: 8px; }
        /* サイドバー：選んだ項目だけを青にする */
        .mgr-nav-forced > * { background-color: var(--mgr-nav-bg) !important; color: var(--mgr-nav-fg) !important; border-color: var(--mgr-nav-bd) !important; }
        .mgr-nav-forced > .mgr-nav-on { background-color: #1976d2 !important; color: #fff !important; border-color: #64b5f6 !important; }
        .mgr-nav-forced > .mgr-nav-on * { color: #fff !important; }
        /* 閉じているときは、タイトル以外をかくす */
        #migration-screen .mgr-block.mgr-collapsed > :not(.mgr-title):not(.mgr-path) { display: none !important; }
        #migration-screen .mgr-block.mgr-collapsed .mgr-path > :not(.mgr-title):not(.mgr-path) { display: none !important; }
        #migration-screen .mgr-block .migration-desc { line-height: 1.7 !important; }
        /* 必要性が高い設定（上のほう）＝赤、いちばん下のほうの設定＝緑 */
        #migration-screen .mgr-block.mgr-red { border: 3px solid #e53935 !important; }
        #migration-screen .mgr-block.mgr-green { border: 3px solid #2e9d4f !important; }
        #migration-screen .mgr-block.mgr-green.mgr-warn .mgr-title::before { content: '⚠️ '; }`;
        document.head.appendChild(st);
    }

    /* ---------- ブロックの見つけかた ---------- */
    const HEADING = 'h1, h2, h3, h4, .migration-title';

    // 並び順（ui-compact-fixes-system.js の migrationBlockOrder）の、上のほう＝必要性が高い設定 → 赤
    const RED_TITLES = [/gzip|圧縮/i, /データのバックアップ/, /会員ランク割引/, /ポイント倍率/, /商品の分類/, /客用画面のお知らせ/, /使い方説明書/,
        /ローカル|ファイル.*バックアップ/, /店長認証/, /税抜き.{0,2}税込み/, /税率をまとめて/, /利用規約|プライバシー/];
    // いちばん下のほうの設定 → 緑
    const GREEN_TITLES = [/ホーム画面の背景/, /ロゴ/, /初期化/];

    function candidates(scr) {
        const out = [];
        scr.querySelectorAll('.migration-block').forEach(b => {
            const p = b.parentElement;
            if (p && p.closest('.migration-block')) return;   // 入れ子の内側は、外側のブロックで扱う
            out.push(b);
        });
        // migration-block のクラスが付いていない設定ブロック（見出しをもつ、画面直下の要素）
        Array.from(scr.children).forEach(el => {
            if (out.includes(el)) return;
            if (!el.tagName || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) return;
            if (el.classList.contains('top-bar') || el.classList.contains('mgr-block')) return;
            if (el.querySelector('.migration-block')) return;          // 入れ物（中に別のブロックがある）は触らない
            if (!el.querySelector(HEADING)) return;
            if ((el.textContent || '').length > 20000) return;
            out.push(el);
        });
        return out;
    }

    function decorate(b) {
        if (b.dataset.mgrDone === '1') return;
        const title = b.querySelector(HEADING);
        if (!title || !(title.textContent || '').trim()) return;
        b.dataset.mgrDone = '1';
        b.classList.add('mgr-block');
        title.classList.add('mgr-title');
        // タイトルが直下でないときは、タイトルまでの途中の要素に目印を付ける
        let p = title.parentElement;
        while (p && p !== b) { p.classList.add('mgr-path'); p = p.parentElement; }
        const ttl = title.textContent || '';
        if (RED_TITLES.some(re => re.test(ttl))) b.classList.add('mgr-red');
        else if (GREEN_TITLES.some(re => re.test(ttl))) b.classList.add('mgr-green');
        if (/初期化|削除/.test(ttl)) b.classList.add('mgr-warn');   // 消す操作には、タイトルに⚠️を付ける

        title.setAttribute('role', 'button');
        title.setAttribute('tabindex', '0');
        title.addEventListener('click', () => b.classList.toggle('mgr-collapsed'));
        title.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); title.click(); }
        });
        b.classList.add('mgr-collapsed');   // はじめは閉じておく
    }

    /* ---------- 定期的に整える ---------- */
    let wasActive = false;
    function tick() {
        const scr = screenEl();
        const active = !!(scr && scr.classList.contains('active'));
        if (!active) { wasActive = false; return; }
        ensureStyle();
        const list = candidates(scr);
        list.forEach(decorate);
        if (!wasActive) {
            // 画面を開いたとき：ぜんぶ閉じた状態にそろえる
            scr.querySelectorAll('.mgr-block').forEach(b => b.classList.add('mgr-collapsed'));
            wasActive = true;
        }
    }

    /* ---------- サイドバー（左の項目）から選んだら、そのブロックを開く ---------- */
    // 記号・絵文字・空白を除いて、項目名とタイトルを比べる
    function norm(s) { return String(s || '').replace(/[^0-9A-Za-z\u3041-\u30ff\u3400-\u9fff\uff10-\uff5a]/g, '').toLowerCase(); }
    function findBlock(scr, item) {
        // 1) href や data-target で行き先が分かるとき
        const ref = item.getAttribute('data-target-id') || item.getAttribute('data-target') || item.getAttribute('data-anchor') || item.getAttribute('href') || '';
        const id = ref.replace(/^#/, '');
        const target = id && document.getElementById(id);
        if (target && scr.contains(target)) {
            const b = target.closest('.mgr-block') || target.querySelector('.mgr-block');
            if (b) return b;
        }
        // 2) 項目の文字と、ブロックのタイトルを比べる
        const label = norm(item.textContent) || norm(item.title);
        if (label.length < 2) return null;
        let best = null, bestDiff = Infinity;
        scr.querySelectorAll('.mgr-block').forEach(b => {
            if (!b.getClientRects().length) return;   // 非表示のブロックは対象外
            const t = norm((b.querySelector('.mgr-title') || {}).textContent);
            if (!t || !(t.includes(label) || label.includes(t))) return;
            const diff = Math.abs(t.length - label.length);
            if (diff < bestDiff) { best = b; bestDiff = diff; }
        });
        return best;
    }
    // 「どの入れ物がスクロールしているか」はブラウザに任せる（scrollIntoView）。
    // smooth だと、サイドバー側のスクロールと取り合いになって途中で止まるので、instant（一瞬で移動）にする。
    function goTo(b) {
        b.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    let navToken = 0;
    // 手でスクロールしたら、自動の合わせ直しをやめる
    ['wheel', 'touchmove'].forEach(ev => document.addEventListener(ev, () => { navToken++; }, { passive: true, capture: true }));
    function openBlock(b) {
        b.classList.remove('mgr-collapsed');
        const my = ++navToken;
        // サイドバー側のスムーズスクロールとぶつかるので、少し間をあけて数回合わせ直す
        [0, 60, 150, 300, 600, 1000].forEach(ms => setTimeout(() => {
            if (my !== navToken) return;
            try { goTo(b); } catch (err) { /* 無視 */ }
        }, ms));
    }
    /* ---------- 選んだ項目を、強制的に青くする（自分でスクロールしたら自動の表示に戻す） ---------- */
    let forced = null;   // { list, item }
    function releaseNav() {
        if (!forced) return;
        forced.list.classList.remove('mgr-nav-forced');
        forced.item.classList.remove('mgr-nav-on');
        forced = null;
    }
    function forceNav(el) {
        releaseNav();
        // 項目が3つ以上並んでいる入れ物（サイドバーの一覧）まで上がる
        let item = el;
        while (item.parentElement && item.parentElement !== document.body && item.parentElement.children.length < 3) item = item.parentElement;
        const list = item.parentElement;
        if (!list || list === document.body && !item.matches('a, button, li, [role="button"]')) return;
        // ほかの項目の「ふだんの色」を調べる（いちばん多い色）
        const common = prop => {
            const count = {};
            Array.from(list.children).forEach(c => { if (c !== item) { const v = getComputedStyle(c)[prop]; count[v] = (count[v] || 0) + 1; } });
            return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
        };
        list.style.setProperty('--mgr-nav-bg', common('backgroundColor'));
        list.style.setProperty('--mgr-nav-fg', common('color'));
        list.style.setProperty('--mgr-nav-bd', common('borderTopColor'));
        list.classList.add('mgr-nav-forced');
        item.classList.add('mgr-nav-on');
        forced = { list, item };
    }
    // 人がスクロールしたら解除する（選んだあとの自動の移動では解除しない）
    const byUser = e => { if (forced && !(e.target instanceof Node && forced.list.contains(e.target))) releaseNav(); };
    ['wheel', 'touchmove', 'pointerdown'].forEach(ev => document.addEventListener(ev, byUser, { passive: true, capture: true }));
    document.addEventListener('keydown', e => { if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key)) releaseNav(); }, true);

    document.addEventListener('click', e => {
        const scr = screenEl();
        if (!scr || !scr.classList.contains('active') || !(e.target instanceof Element)) return;
        if (e.target.closest('.mgr-block, .top-bar, .back-btn')) return;   // ブロックの中・戻るボタンは対象外
        const item = e.target.closest('a, button, li, [role="button"], [data-target], [data-anchor]') || e.target;
        if ((item.textContent || '').trim().length > 60) return;           // 大きな入れ物を押したときは何もしない
        tick();
        const b = findBlock(scr, item);
        if (b) { forceNav(item); openBlock(b); }
    }, true);

    ensureStyle();
    setInterval(tick, 1000);
    // 画面が開かれた瞬間にも、すぐ反映（setTimeout＝描画を止めない。取り合い防止のため回数も制限）
    (function watch() {
        const scr = screenEl();
        if (!scr || !window.MutationObserver) return;
        let q = false, times = [];
        new MutationObserver(() => {
            if (q) return; q = true;
            setTimeout(() => {
                q = false;
                const now = Date.now();
                times = times.filter(t => now - t < 2000);
                if (times.length >= 6) return;
                times.push(now);
                tick();
            }, 0);
        }).observe(scr, { attributes: true, attributeFilter: ['class'] });   // 画面の開閉(class)だけ見る
    })();
    setTimeout(tick, 300);
})();
