// ==========================================
// product-area-expand-system.js
// レジ画面の商品一覧を大きく表示する
//  ・大きい表示（初期）：テンキーの列を隠し、合計金額と操作ボタンを低くして、商品一覧を画面の下まで広げる
//  ・検索欄の横のボタンで「テンキーを出す（元の表示）」⇔「商品一覧を大きく」を切り替える（この端末に記憶）
//  ・index.html の product-button-layout-system.js より後で読み込む
// ==========================================
(function productAreaExpand() {
    'use strict';
    if (window.__productAreaExpandInstalled) return;
    window.__productAreaExpandInstalled = true;

    const KEY = 'haru_product_area_big_v1';
    const ROOT = '#register-screen.pae-big';
    let big = true;
    try { big = localStorage.getItem(KEY) !== '0'; } catch (e) { /* 無視 */ }

    const css = `
    ${ROOT} .numpad-col { display: none !important; }
    ${ROOT} .controls-area { display: flex !important; flex: 0 0 auto !important; min-height: 0 !important; max-height: none !important; }
    ${ROOT} #custom-buttons-area { flex: 1 1 auto !important; width: 100% !important; min-width: 0 !important; max-height: none !important; box-sizing: border-box !important; }
    ${ROOT} .display-area { flex: 0 0 auto !important; min-height: 0 !important; height: auto !important; padding-top: 4px !important; padding-bottom: 4px !important; margin-bottom: 4px !important; }
    ${ROOT} .display-total-label { font-size: 12px !important; margin: 0 !important; line-height: 1.2 !important; }
    ${ROOT} .display-total { font-size: clamp(26px, 6vh, 40px) !important; margin: 0 !important; line-height: 1.1 !important; }
    ${ROOT} .fixed-actions-container { display: grid !important; grid-template-columns: repeat(8, minmax(0, 1fr)) !important; gap: 4px !important;
        flex: 0 0 auto !important; height: auto !important; min-height: 0 !important; margin-bottom: 4px !important; }
    ${ROOT} .fixed-actions-container .action-btn { height: 42px !important; min-height: 0 !important; padding: 2px !important; margin: 0 !important; font-size: 13px !important; line-height: 1.2 !important; aspect-ratio: auto !important; }
    ${ROOT} .fixed-actions-container .action-btn small, ${ROOT} .fixed-actions-container .action-btn br { display: none !important; }
    @media (max-width: 700px) { ${ROOT} .fixed-actions-container { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; } }
    #register-screen .product-search-box { display: flex !important; gap: 6px; align-items: center; }
    #register-screen .product-search-box input { flex: 1 1 auto; min-width: 0; }
    #pae-toggle { flex: 0 0 auto; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; font-weight: 700; background: #1976d2; color: #fff; cursor: pointer; white-space: nowrap; }`;

    const screen = () => document.getElementById('register-screen');
    const area = () => document.getElementById('custom-buttons-area');
    let lastW = 0;

    // 商品一覧の高さを「いまの位置から画面の下まで」にする
    function fit() {
        const s = screen(), a = area();
        if (!s || !a || !s.classList.contains('active')) return;
        const box = a.closest('.controls-area');
        if (!big) return;
        const top = a.getBoundingClientRect().top + window.scrollY;
        let h = Math.floor(window.innerHeight - top - 8);
        if (h < 260) h = Math.floor(window.innerHeight * 0.7);   // スマホなど、上が長いときは画面の7割
        const px = h + 'px';
        [a, box].forEach(el => {
            if (el && el.style.height !== px) el.style.setProperty('height', px, 'important');
        });
        redrawIfResized();
    }
    // 横幅が変わったら、商品ボタンを描き直す（編集中は触らない）
    function redrawIfResized() {
        const a = area();
        if (!a || !a.clientWidth || a.clientWidth === lastW || a.querySelector('.pbl-edit')) return;
        lastW = a.clientWidth;
        if (typeof window.generateCustomButtons === 'function') window.generateCustomButtons();
    }

    function apply() {
        const s = screen();
        if (!s) return;
        s.classList.toggle('pae-big', big);
        const b = document.getElementById('pae-toggle');
        if (b) b.textContent = big ? '🔢 テンキーを出す' : '⤢ 商品一覧を大きく';
        if (!big) {
            const a = area();
            [a, a && a.closest('.controls-area')].forEach(el => { if (el) el.style.removeProperty('height'); });
            redrawIfResized();
        } else {
            fit();
        }
    }

    function boot() {
        const s = screen();
        const searchBox = s && s.querySelector('.product-search-box');
        if (!searchBox) return;
        const st = document.createElement('style');
        st.id = 'pae-style';
        st.textContent = css;
        document.head.appendChild(st);

        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'pae-toggle';
        b.addEventListener('click', () => {
            big = !big;
            try { localStorage.setItem(KEY, big ? '1' : '0'); } catch (e) { /* 無視 */ }
            if (typeof playSound === 'function') playSound('click');
            apply();
            if (typeof focusJanInput === 'function') focusJanInput();
        });
        searchBox.appendChild(b);
        apply();

        new MutationObserver(() => setTimeout(fit, 0)).observe(s, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', fit);
        setInterval(fit, 700);   // 会員表示やツールバーで位置が変わったときに合わせ直す
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
