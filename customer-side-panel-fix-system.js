// ==========================================
// customer-side-panel-fix-system.js
// 客用画面の「お支払方法（クレジット／QR決済）」と「会員情報カード」が、
// 上のお知らせ帯や、下の金額バー（ご請求金額・お預かり・お釣り）の裏に隠れないようにする
//
//  ・パネル（#customer-side-panel）が、下の金額バーに重なっていたら、バーのすぐ上まで持ち上げる
//  ・パネルが、上に固定表示されている帯（お知らせの流れる帯など）に重なっていたら、その下へ下げる
//  ・「クレジット／QR決済」の文字（#customer-payment-badge）を、少し下げる
//  ・会員カード・お支払方法が、パネルの外に出ていても、それぞれ同じように見える位置へ動かす
//
// ・style.css / index.html / 他のJSは変更しない（後から重ねる方式）。
// ・index.html の </body> の直前に <script src="customer-side-panel-fix-system.js"></script> を1行足すだけ。
// ==========================================
(function customerSidePanelFix() {
    'use strict';
    if (window.__customerSidePanelFixInstalled) return;
    window.__customerSidePanelFixInstalled = true;

    const MARGIN = 8;          // 帯・バーとのすきま(px)
    const BADGE_DOWN = 12;     // 「クレジット／QR決済」を下げる量(px)。もっと下げたいときはここを増やす

    function ensureStyle() {
        if (document.getElementById('cspf-style')) return;
        const st = document.createElement('style');
        st.id = 'cspf-style';
        st.textContent = `
        #customer-screen .customer-side-panel { gap: ${BADGE_DOWN + 6}px; }
        #customer-screen .customer-payment-badge { position: relative; top: ${BADGE_DOWN}px; }`;
        document.head.appendChild(st);
    }

    const shown = el => !!(el && el.getClientRects().length);

    // 画面の上に固定表示されている「帯」（お知らせなど）の下端を探す
    function topObstacleBottom(el, natTop, natLeft, natRight) {
        let limit = 0;
        const y = Math.max(1, Math.round(natTop + 2));
        const xs = [natLeft + 10, (natLeft + natRight) / 2, natRight - 10]
            .map(x => Math.min(Math.max(1, Math.round(x)), window.innerWidth - 1));
        xs.forEach(x => {
            document.elementsFromPoint(x, y).forEach(o => {
                if (o === el || el.contains(o) || o.contains(el)) return;
                if (o === document.body || o === document.documentElement) return;
                if (o.id === 'customer-screen' || o.classList.contains('customer-card') || o.classList.contains('customer-total-area')) return;
                const cs = getComputedStyle(o);
                if (!/^(fixed|absolute|sticky)$/.test(cs.position)) return;
                const r = o.getBoundingClientRect();
                // 横に広くて背の低いもの（＝帯）だけを対象にする
                if (r.height > 220 || r.width < window.innerWidth * 0.5) return;
                if (r.top <= y && r.bottom > y) limit = Math.max(limit, r.bottom);
            });
        });
        return limit ? limit + MARGIN : 0;
    }

    function fit(el, bar) {
        if (!el || !shown(el)) return;
        const dy0 = Number(el.dataset.cspfDy || 0);
        const r = el.getBoundingClientRect();
        const natTop = r.top - dy0, natBottom = r.bottom - dy0;
        const barTop = bar && shown(bar) ? bar.getBoundingClientRect().top : window.innerHeight;
        let dy = 0;
        if (natBottom > barTop - MARGIN) {
            dy = (barTop - MARGIN) - natBottom;                         // 下の金額バーの裏 → 上へ
        } else {
            const lim = topObstacleBottom(el, natTop, r.left, r.right);
            if (lim && natTop < lim) dy = lim - natTop;                  // 上の帯の裏 → 下へ
        }
        dy = Math.round(dy);
        if (dy === dy0) return;
        el.dataset.cspfDy = String(dy);
        el.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
    }

    function tick() {
        const scr = document.getElementById('customer-screen');
        if (!scr || !scr.classList.contains('active')) return;
        ensureStyle();
        const bar = scr.querySelector('.customer-total-area');
        const panel = document.getElementById('customer-side-panel');
        const card = document.getElementById('customer-member-card');
        const badge = document.getElementById('customer-payment-badge');
        fit(panel, bar);
        // パネルの外に出ている部品は、それぞれ単独で見える位置に直す
        [card, badge].forEach(p => { if (p && (!panel || !panel.contains(p))) fit(p, bar); });
    }

    ensureStyle();
    setInterval(tick, 500);
    window.addEventListener('resize', tick);
    setTimeout(tick, 300);
})();
