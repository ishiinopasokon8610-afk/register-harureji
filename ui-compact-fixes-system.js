// ==========================================
// ui-compact-fixes-system.js
// ① 詐欺注意の同意画面（#customer-fraud-modal）を、スクロール無しの1画面にまとめる（スマホ・PC）
// ② 「この端末を客用ディスプレイにする」の項目が残っていたら非表示にする
//    （客用ディスプレイかどうかは、客用画面を開いているかで自動判定されるため）
// style.css は変更せず、後から上書きする。index.html で一番最後に読み込む。
// ==========================================
(function uiCompactFixes() {
    'use strict';

    const css = `
    #customer-fraud-modal { overflow: hidden !important; padding: 0 !important; box-sizing: border-box !important; }
    #customer-fraud-modal .customer-fraud-box {
        box-sizing: border-box !important;
        width: min(94vw, 760px) !important;
        max-width: 94vw !important;
        max-height: 96vh !important;
        max-height: 96dvh !important;
        overflow: hidden !important;
        margin: 0 auto !important;
        padding: clamp(10px, 3vh, 28px) clamp(14px, 4vw, 36px) !important;
        display: flex !important; flex-direction: column !important;
        align-items: center !important; justify-content: center !important;
        gap: clamp(6px, 2vh, 18px) !important;
        text-align: center !important;
    }
    #customer-fraud-modal .fraud-icon { font-size: clamp(34px, 11vh, 80px) !important; line-height: 1 !important; margin: 0 !important; }
    #customer-fraud-modal .fraud-title { font-size: clamp(20px, 5.5vh, 40px) !important; line-height: 1.25 !important; margin: 0 !important; }
    #customer-fraud-modal .fraud-desc { font-size: clamp(13px, 3.4vh, 24px) !important; line-height: 1.5 !important; margin: 0 !important; }
    #customer-fraud-modal .fraud-btn-group { margin: 0 !important; width: 100% !important; display: flex !important; justify-content: center !important; }
    #customer-fraud-modal .fraud-btn {
        font-size: clamp(16px, 4.5vh, 30px) !important;
        padding: clamp(8px, 2vh, 16px) clamp(24px, 8vw, 60px) !important;
        min-width: min(70vw, 320px) !important; margin: 0 !important;
    }

    #customer-age-modal { overflow: hidden !important; padding: 0 !important; box-sizing: border-box !important; }
    #customer-age-modal .customer-age-box {
        box-sizing: border-box !important;
        width: min(94vw, 760px) !important; max-width: 94vw !important;
        max-height: 96vh !important; max-height: 96dvh !important;
        overflow: hidden !important; margin: 0 auto !important;
        padding: clamp(10px, 3vh, 28px) clamp(14px, 4vw, 36px) !important;
        display: flex !important; flex-direction: column !important;
        align-items: center !important; justify-content: center !important;
        gap: clamp(6px, 2vh, 18px) !important; text-align: center !important;
    }
    #customer-age-modal .age-icon { font-size: clamp(34px, 11vh, 80px) !important; line-height: 1 !important; margin: 0 !important; }
    #customer-age-modal .age-title { font-size: clamp(20px, 5.5vh, 40px) !important; line-height: 1.25 !important; margin: 0 !important; }
    #customer-age-modal .age-desc { font-size: clamp(13px, 3.4vh, 24px) !important; line-height: 1.5 !important; margin: 0 !important; }
    #customer-age-modal .age-btn-group { margin: 0 !important; width: 100% !important; display: flex !important; justify-content: center !important; gap: clamp(8px, 3vw, 24px) !important; flex-wrap: nowrap !important; }
    #customer-age-modal .age-btn {
        font-size: clamp(15px, 4.2vh, 28px) !important;
        padding: clamp(8px, 2vh, 16px) clamp(14px, 5vw, 44px) !important;
        flex: 1 1 0 !important; min-width: 0 !important; max-width: 320px !important; margin: 0 !important;
    }
    @media (max-height: 420px) {
        #customer-age-modal .customer-age-box { flex-direction: row !important; flex-wrap: wrap !important; }
        #customer-age-modal .age-icon { font-size: 30px !important; }
    }
    @media (max-height: 420px) {
        #customer-fraud-modal .customer-fraud-box { flex-direction: row !important; flex-wrap: wrap !important; }
        #customer-fraud-modal .fraud-icon { font-size: 30px !important; }
    }`;
    function addStyle() {
        if (document.getElementById('ui-compact-fixes-style')) return;
        const st = document.createElement('style');
        st.id = 'ui-compact-fixes-style';
        st.textContent = css + '\n.migration-block:has(#customer-display-device-check){display:none !important;}';
        document.head.appendChild(st);
    }
    addStyle();

    function hideCustomerDisplayToggle() {
        try {
            document.querySelectorAll('button,label,li,a,h3,.migration-block,.menu-item,div').forEach((el) => {
                if (el.dataset.cdHidden === '1') return;
                const t = (el.textContent || '').replace(/\s+/g, '');
                if (!t.includes('客用ディスプレイ')) return;
                if (!/この端末|として使う|にする/.test(t)) return;
                // 子要素に同じ文言を含むものがあれば、そちら（より小さい要素）で判定する
                const childHit = Array.from(el.children).some(c => (c.textContent || '').replace(/\s+/g, '').includes('客用ディスプレイ'));
                if (childHit && el.tagName === 'DIV' && !el.classList.contains('migration-block')) return;
                if (t.length > 700) return; // 大きな入れ物は隠さない
                if (el.querySelector('input,button') && el.classList.contains('migration-block') === false && el.tagName === 'DIV') return;
                el.style.setProperty('display', 'none', 'important');
                el.dataset.cdHidden = '1';
            });
        } catch (e) { /* 無視 */ }
    }
    hideCustomerDisplayToggle();
    setInterval(hideCustomerDisplayToggle, 1500);
    if (window.MutationObserver) {
        let t = null;
        new MutationObserver(() => { clearTimeout(t); t = setTimeout(hideCustomerDisplayToggle, 200); })
            .observe(document.documentElement, { childList: true, subtree: true });
    }
})();

// ===== レシート（お会計レシートの表示・印刷・保存）は、ダークモードでも「背景：白／文字：黒」に固定する =====
(function receiptAlwaysWhiteBlack() {
    'use strict';
    if (document.getElementById('receipt-white-black-style')) return;
    const st = document.createElement('style');
    st.id = 'receipt-white-black-style';
    st.textContent = `
    #receipt-capture-area, #receipt-capture-area *:not(img):not(canvas):not(svg),
    #print-receipt-content, #print-receipt-content *:not(img):not(canvas):not(svg) {
        background-color: #ffffff !important; color: #000000 !important;
        text-shadow: none !important; filter: none !important;
    }
    #receipt-capture-area img, #print-receipt-content img { filter: none !important; }
    @media print {
        body, #receipt-print-modal { background: #ffffff !important; }
    }`;
    document.head.appendChild(st);
})();

// 「お客様について」（性別・年齢層）の画面で、ENTERキーで「次へ」に進む
(function enterKeyForCustomerInfo() {
    'use strict';
    if (window.__enterCustInfoInstalled) return;
    window.__enterCustInfoInstalled = true;
    function visible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
    }
    function findNextButton() {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const t = (b.textContent || '').trim();
            if (!t.startsWith('次へ') || !visible(b)) continue;
            // 同じ画面の中に「お客様について」「年齢層」の見出しがあるときだけ
            let p = b.parentElement;
            for (let d = 0; p && d < 6; d++, p = p.parentElement) {
                const tx = p.textContent || '';
                if (tx.includes('お客様について') && tx.includes('年齢層')) return b;
            }
        }
        return null;
    }
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.repeat || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
        try {
            const b = findNextButton();
            if (!b) return;
            e.preventDefault(); e.stopImmediatePropagation();
            b.click();
        } catch (err) { console.warn('Enterキー処理エラー', err); }
    }, true);
})();

// データ管理画面：よく使う・大切な設定を上に、すぐやらなくていい設定を下に並べる
(function migrationBlockOrder() {
    'use strict';
    // 数字が小さいほど上。登録外のブロックは真ん中（50）。
    const RULES = [
        [/gzip|圧縮/i, 0], [/データのバックアップ/, 0.5], [/会員ランク割引/, 1], [/ポイント倍率/, 1.5], [/商品の分類/, 2], [/客用画面のお知らせ/, 2.5], [/使い方説明書/, 3], [/ローカル|ファイル.*バックアップ/, 4], [/店長認証/, 5], [/税抜き.{0,2}税込み/, 6], [/税率をまとめて/, 7], [/利用規約|プライバシー/, 8],
        [/セルフレジ/, 13], [/お席案内|呼び出し/, 14], [/お会計完了時/, 20],
        [/ホーム画面の背景/, 80], [/ロゴ/, 81], [/初期化/, 99]
    ];
    function titleOf(b) {
        const h = b.querySelector('.migration-title, h1, h2, h3, h4');
        return ((h ? h.textContent : b.textContent) || '').trim().slice(0, 80);
    }
    function rank(b) {
        const t = titleOf(b);
        for (const [re, n] of RULES) if (re.test(t)) return n;
        return 50;
    }
    function isBlock(el) {
        if (!el || !el.classList || el.classList.contains('top-bar')) return false;
        if (el.classList.contains('migration-block')) return true;
        // 設定ブロック（migration-block クラスが無いもの）も、見出しが並べ替えの対象に当たれば動かす
        return RULES.some(([re]) => re.test(titleOf(el))) && el.querySelector('h1, h2, h3, h4, .migration-title');
    }
    function run() {
        const scr = document.getElementById('migration-screen');
        if (!scr || !scr.classList.contains('active')) return; // データ管理を開いている時だけ並べ替える
        // 「客用ディスプレイ」の設定ブロックは使わないので隠す
        Array.from(scr.children).forEach(el => {
            if (el.classList && el.classList.contains('migration-block') && /客用ディスプレイ/.test((el.querySelector('.migration-title') || {}).textContent || '')) el.style.display = 'none';
        });
        const blocks = Array.from(scr.children).filter(isBlock);
        if (blocks.length < 2) return;
        const sorted = blocks.map((b, i) => ({ b, i, r: rank(b) })).sort((x, y) => x.r - y.r || x.i - y.i).map(o => o.b);
        if (sorted.every((b, i) => b === blocks[i])) return;
        // 入力中・操作中は並べ替えない（画面が勝手に一番上へ戻るのを防ぐ）
        const ae = document.activeElement;
        if (ae && scr.contains(ae) && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(ae.tagName)) return;
        if (Date.now() - lastTouch < 3000) return;
        // 並べ替えで位置が飛ばないように、スクロール位置を覚えて戻す
        const sy = window.scrollY, sx = window.scrollX;
        const se = document.scrollingElement;
        const st = se ? se.scrollTop : 0;
        const scrTop = scr.scrollTop;
        sorted.forEach(b => scr.appendChild(b));
        window.scrollTo(sx, sy);
        if (se) se.scrollTop = st;
        scr.scrollTop = scrTop;
    }
    // 【修正】操作中の目印は「データ管理画面の中での操作」だけにする。
    // 以前は画面のどこを触っても記録していたため、ホームで「データ管理」を押して開いた直後は
    // 「操作中」とみなされ、並べ替えが3秒ほど待たされていた。
    let lastTouch = 0;
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, (e) => {
        const scr = document.getElementById('migration-screen');
        if (scr && e.target instanceof Node && scr.contains(e.target)) lastTouch = Date.now();
    }, { passive: true, capture: true }));

    // 【修正】1.5秒ごとの確認だけに頼らず、画面が開かれた時・ブロックが増えた時に、すぐ（描画の前に）並べ替える。
    // ・マイクロタスクではなく setTimeout(0) で動かす（他のJSと取り合いになっても画面が固まらない）
    // ・2秒に6回を超えて続くときは、取り合いとみなして即時反映をやめる（1秒ごとの確認だけに戻る）
    let queued = false;
    let runTimes = [];
    function runSoon() {
        if (queued) return;
        queued = true;
        setTimeout(() => {
            queued = false;
            const now = Date.now();
            runTimes = runTimes.filter(t => now - t < 2000);
            if (runTimes.length >= 6) return;
            runTimes.push(now);
            try { run(); } catch (e) { /* 無視 */ }
        }, 0);
    }
    function watch() {
        const scr = document.getElementById('migration-screen');
        if (!scr || !window.MutationObserver) return false;
        new MutationObserver(runSoon).observe(scr, { childList: true, attributes: true, attributeFilter: ['class'] });
        runSoon();
        return true;
    }
    if (!watch()) document.addEventListener('DOMContentLoaded', watch);
    setInterval(run, 1000);   // 念のための保険
})();
