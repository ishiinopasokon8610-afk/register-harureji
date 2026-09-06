// ==========================================
// deposit-shortage-guard-system.js
// お預かり金額が合計金額より少ない状態での「お会計・レシート発行」を防止する
// ------------------------------------------
// 【背景】
// 忙しい時間帯のレジ打ちでは、現金会計時に預かり金の入力を間違えて
// 合計未満のまま completeTransaction() を実行できてしまう。
// これを後から気づかず放置すると、売上データ（XLSX）や現金残高（精算）
// が大幅に狂う原因になる。
//
// 【この機能】
//   ① calculateChange() をフックし、入力のたびに「不足しているか」を判定して
//      警告表示・「お会計・レシート発行」ボタンの活性/非活性を切り替える。
//   ② selectPayMethod() / openCheckout() でも表示を更新する
//      （支払い方法の切り替えや、お会計モーダルを開いた直後にも反映するため）。
//   ③ 最後の砦として completeTransaction() 自体もフックし、
//      万一ボタン無効化をすり抜けても（Enterキー等）二重に防止する。
// 現金以外（クレジット／QR決済）は対象外とする。
//
// register.js / ui.js / index.html は直接編集せず、
// 他の追加機能ファイルと同じ「フック方式」で実現する。
// ==========================================

function getCompleteButtonEl() {
    return document.querySelector('#checkout-step-pay .complete-btn');
}

// billingAmount（ポイント充当後の請求額）があればそれを優先。
// 無ければ currentTotal（合計金額）にフォールバックする。
function getCurrentBillingAmountSafe() {
    if (typeof billingAmount !== 'undefined' && billingAmount !== null) return billingAmount;
    if (typeof currentTotal !== 'undefined' && currentTotal !== null) return currentTotal;
    return 0;
}

function isCashDepositShortage() {
    // 現金以外の支払い方法は対象外
    if (typeof selectedPayment !== 'undefined' && selectedPayment !== '現金') return false;

    const deposit = (typeof currentDeposit !== 'undefined' && currentDeposit !== null) ? currentDeposit : 0;
    return deposit < getCurrentBillingAmountSafe();
}

function ensureDepositShortageWarningEl() {
    let el = document.getElementById('deposit-shortage-warning');
    if (el) return el;

    const box = document.getElementById('change-display-box');
    if (!box || !box.parentNode) return null;

    el = document.createElement('div');
    el.id = 'deposit-shortage-warning';
    el.style.cssText = 'color:#d32f2f; font-weight:bold; text-align:center; margin-top:4px; display:none;';
    el.innerText = '⚠️ お預かり金額が不足しています';
    box.parentNode.insertBefore(el, box.nextSibling);
    return el;
}

function refreshDepositShortageUI() {
    const warningEl = ensureDepositShortageWarningEl();
    const btn = getCompleteButtonEl();
    const shortage = isCashDepositShortage();

    if (warningEl) warningEl.style.display = shortage ? 'block' : 'none';
    if (btn) {
        btn.disabled = shortage;
        btn.style.opacity = shortage ? '0.5' : '';
        btn.style.cursor = shortage ? 'not-allowed' : '';
    }
}

/* ---------- ① calculateChange() をフック ---------- */
(function hookCalculateChangeForShortageGuard() {
    function tryHook() {
        if (typeof window.calculateChange !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.calculateChange;
        window.calculateChange = function (...args) {
            const result = original.apply(this, args);
            refreshDepositShortageUI();
            return result;
        };
    }
    tryHook();
})();

/* ---------- ② selectPayMethod() / openCheckout() をフック ---------- */
(function hookSelectPayMethodForShortageGuard() {
    function tryHook() {
        if (typeof window.selectPayMethod !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.selectPayMethod;
        window.selectPayMethod = function (...args) {
            const result = original.apply(this, args);
            refreshDepositShortageUI();
            return result;
        };
    }
    tryHook();
})();

(function hookOpenCheckoutForShortageGuard() {
    function tryHook() {
        if (typeof window.openCheckout !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.openCheckout;
        window.openCheckout = function (...args) {
            const result = original.apply(this, args);
            refreshDepositShortageUI();
            return result;
        };
    }
    tryHook();
})();

/* ---------- ③ 最後の砦：completeTransaction() 自体もフック ---------- */
(function hookCompleteTransactionForShortageGuard() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            if (isCashDepositShortage()) {
                if (typeof playSound === 'function') playSound('error');
                if (typeof speak === 'function') speak('おあずかり きんがく が ふそく し て い ます');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm(
                        'お預かり金額が合計金額に届いていません。金額をご確認ください。',
                        'おあずかり きんがく が ごうけい に とどい て い ませ ん。',
                        () => {},
                        false
                    );
                } else {
                    alert('お預かり金額が合計金額に届いていません。');
                }
                return;
            }
            return original.apply(this, args);
        };
    }
    tryHook();
})();
