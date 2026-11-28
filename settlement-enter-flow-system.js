// ==========================================
// settlement-enter-flow-system.js
// 売上管理・精算画面を、Enterキーだけで最後まで進められるようにする
//
//  ① 枚数の入力欄（1万円札 → 5千円札 → … → 1円玉）で Enter を押すと、
//     ひとつ下の欄へ移る（欄が空でもOK＝0枚として進む）。Shift+Enter で、ひとつ上へ戻る。
//  ② いちばん下（1円玉）で Enter を押すと、「本日の業務を終了（ログアウト）」ボタンに移る。
//  ③ そのボタンの上でもう一度 Enter を押すと、清算（業務終了）の処理に進む。
//     ・過不足が0円 … 「本日の業務を終了しますか？」の確認 → Enter で「はい」
//     ・過不足がある … これまで通り店長認証（店長バーコード）が必要
//
//  ④ 「業務再開（準備金の入力）」でも同じ。Enter で次の欄へ（Shift+Enter で前へ）、
//     1円の次は「再開を確定」ボタンに移り、もう一度 Enter で確定する。
//
// ・sales-mgmt.js / index.html の中身は変更しない（後から重ねる方式）。
// ・既存の calculateEndCash() / closeBusiness() をそのまま使う。
// ==========================================
(function settlementEnterFlow() {
    'use strict';
    if (window.__settlementEnterFlowInstalled) return;
    window.__settlementEnterFlowInstalled = true;

    let lastCloseClickAt = 0;

    function screenEl() { return document.getElementById('sales-mgmt-screen'); }
    function isVisible(el) {
        if (!el) return false;
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
    }
    function endInputs() {
        const scr = screenEl();
        return scr ? Array.from(scr.querySelectorAll('.end-cash-input')) : [];
    }
    function recalc() {
        try { if (typeof calculateEndCash === 'function') calculateEndCash(); } catch (e) { /* 無視 */ }
    }
    function focusInput(el) {
        if (!el) return;
        el.focus();
        try { el.select(); } catch (e) { /* 無視 */ }
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 無視 */ }
    }
    function playClick() {
        try { if (typeof playSound === 'function') playSound('click'); } catch (e) { /* 無視 */ }
    }

    // ---- 枚数の欄・業務終了ボタンでの Enter ----
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
        const t = e.target;
        const scr = screenEl();
        if (!t || !scr || !scr.contains(t)) return;

        // (A) 枚数の入力欄
        if (t.classList && t.classList.contains('end-cash-input')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.repeat) return;
            const inputs = endInputs();
            const i = inputs.indexOf(t);
            recalc();
            playClick();
            if (e.shiftKey) {
                if (i > 0) focusInput(inputs[i - 1]);
                return;
            }
            if (i >= 0 && i < inputs.length - 1) {
                focusInput(inputs[i + 1]);
            } else {
                // 一番下まで来た → 業務終了ボタンへ
                const btn = document.getElementById('btn-close-business');
                if (btn) {
                    btn.disabled = false; // calculateEndCash() が有効にするが、念のため
                    btn.focus();
                    try { btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { /* 無視 */ }
                }
            }
            return;
        }

        // (B) 業務終了ボタンの上での Enter
        if (t.id === 'btn-close-business') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.repeat || t.disabled) return;
            lastCloseClickAt = Date.now();
            t.click();
        }
    }, true);

    // ---- 「本日の業務を終了しますか？」の確認ダイアログで Enter = はい ----
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        const scr = screenEl();
        if (!scr || !scr.classList.contains('active')) return;
        const modal = document.getElementById('custom-confirm-modal');
        if (!isVisible(modal)) return;
        // 押しっぱなし・押した直後の二重Enterで、うっかり確定しないように少し待つ
        if (Date.now() - lastCloseClickAt < 350) return;
        const text = (document.getElementById('custom-confirm-text') || {}).innerText || '';
        if (!/本日の業務を終了/.test(text)) return;
        const yes = document.getElementById('custom-confirm-yes-btn');
        if (!yes) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        yes.click();
    }, true);

    // ---- 画面を開いたら、最初の欄（1万円札）にカーソルを置く ----
    let wasActive = false;
    setInterval(function () {
        const scr = screenEl();
        const active = !!(scr && scr.classList.contains('active'));
        if (active && !wasActive) {
            setTimeout(function () {
                const inputs = endInputs();
                const ae = document.activeElement;
                if (inputs[0] && !(ae && scr.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) {
                    inputs[0].focus();
                }
            }, 150);
        }
        wasActive = active;
    }, 400);

    // ---- 業務再開（準備金の入力）も Enter で順に進む ----
    function startModal() { return document.getElementById('business-start-modal'); }
    function startConfirmButton() {
        const m = startModal();
        return m ? m.querySelector('button[onclick^="confirmStartBusiness"]') : null;
    }
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
        const t = e.target;
        const m = startModal();
        if (!t || !m || !m.contains(t)) return;
        const btn = startConfirmButton();
        const isInput = t.classList && t.classList.contains('start-cash-input');
        if (!isInput && t !== btn) return;   // キャンセルボタンは、いつも通り
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;                // 押しっぱなしで確定まで進まないように
        if (t === btn) { btn.click(); return; }
        const inputs = Array.from(m.querySelectorAll('.start-cash-input'));
        const i = inputs.indexOf(t);
        try { if (typeof calculateStartCash === 'function') calculateStartCash(); } catch (err) { /* 無視 */ }
        playClick();
        if (e.shiftKey) {
            if (i > 0) focusInput(inputs[i - 1]);
        } else if (i < inputs.length - 1) {
            focusInput(inputs[i + 1]);
        } else if (btn) {
            btn.focus();
            try { btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { /* 無視 */ }
        }
    }, true);

    // 準備金の入力を開いたら、1万円の欄にカーソルを置く
    let startWasOpen = false;
    setInterval(function () {
        const m = startModal();
        const open = !!m && isVisible(m);
        if (open && !startWasOpen) {
            setTimeout(function () {
                const first = m.querySelector('.start-cash-input');
                if (first && !m.contains(document.activeElement)) focusInput(first);
            }, 150);
        }
        startWasOpen = open;
    }, 300);
})();
