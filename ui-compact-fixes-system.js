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
