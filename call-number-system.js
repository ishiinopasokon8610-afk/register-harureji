// ==========================================
// call-number-system.js
// 「呼び出し番号を出す」（order-system-settings.js の✅）がONの場合、
// 会計が成立するたびに、001から順番に呼び出し番号を自動採番し、
// 画面に大きく表示＋音声で読み上げる。
// ------------------------------------------
// ・番号は 001〜999 の3桁で、999の次は001に戻る。
// ・「本日の業務を終了」（closeBusiness）が呼ばれたタイミングで
//   翌営業日に備えて001に戻す（レジ閉局＝営業日の区切りとみなす）。
//   ※ この「営業日で番号をリセットする」という仕様は、お店ごとに
//     運用が異なる可能性があるため、必要に応じて
//     resetCallNumberCounter() の呼び出し箇所を調整してください。
//
// register.js / order-system-settings.js / index.html は直接編集せず、
// completeTransaction() と closeBusiness() をラップして実現する
// （他の追加機能ファイルと同じ「フック方式」）。
//
// order-checkout-display.js が導入されている場合は、直近の注文カードにも
// 呼び出し番号を差し込む（互いにtypeofで存在確認するだけの緩い連携で、
// どちらか片方だけが入っている環境でも問題なく動く）。
// ==========================================

const CALL_NUMBER_COUNTER_KEY = 'pos_call_number_counter';
const CALL_NUMBER_MAX = 999;

function getCallNumberCounter() {
    const n = parseInt(localStorage.getItem(CALL_NUMBER_COUNTER_KEY) || '0', 10);
    return isNaN(n) ? 0 : n;
}

function setCallNumberCounter(n) {
    localStorage.setItem(CALL_NUMBER_COUNTER_KEY, String(n));
}

function formatCallNumber(n) {
    return String(n).padStart(3, '0');
}

// 次の番号を発行する（999の次は1に戻る）
function issueNextCallNumber() {
    const current = getCallNumberCounter();
    const next = (current % CALL_NUMBER_MAX) + 1;
    setCallNumberCounter(next);
    return next;
}

function resetCallNumberCounter() {
    setCallNumberCounter(0);
}

/* =========================================================
   ① completeTransaction() をラップし、会計成立時に採番する
   ========================================================= */
(function hookCompleteTransactionForCallNumber() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            let beforeLen = 0;
            try {
                beforeLen = (JSON.parse(localStorage.getItem('pos_history')) || []).length;
            } catch (e) {}

            const result = await original.apply(this, args);

            if (typeof isShowCallNumberEnabled === 'function' && isShowCallNumberEnabled()) {
                try {
                    const historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
                    if (historyList.length > beforeLen) {
                        const num = issueNextCallNumber();
                        historyList[0].callNumber = num;
                        localStorage.setItem('pos_history', JSON.stringify(historyList));
                        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();

                        // 画面ポップアップは不要とのことなので表示しない（レシート印字のみで運用）
                        announceCallNumber(num);
                        syncCallNumberIntoOrderDisplay(historyList[0], num);
                    }
                } catch (e) { console.error(e); }
            }

            return result;
        };
    }
    tryHook();
})();

// order-checkout-display.js が入っている場合、直近の注文カードにも
// 呼び出し番号を反映する（無ければ何もしない）
function syncCallNumberIntoOrderDisplay(historyRecord, num) {
    if (typeof getLastOrderDisplay !== 'function' || typeof saveLastOrderDisplay !== 'function') return;
    const record = getLastOrderDisplay();
    if (!record) return;
    // 同じ会計かどうかを、取引番号（あれば）か日時で緩く照合する
    const sameTransaction =
        (record.receiptNo && historyRecord.receiptNo && record.receiptNo === historyRecord.receiptNo) ||
        (record.dateISO && historyRecord.dateISO && record.dateISO === historyRecord.dateISO);
    if (!sameTransaction) return;

    record.callNumber = num;
    saveLastOrderDisplay(record);
    if (typeof broadcastOrderDisplay === 'function') broadcastOrderDisplay(record);
    if (typeof renderAllOrderCards === 'function') renderAllOrderCards();
}

/* =========================================================
   ② closeBusiness() をラップし、レジ閉局のタイミングで番号をリセットする
   ========================================================= */
(function hookCloseBusinessForCallNumber() {
    function tryHook() {
        if (typeof window.closeBusiness !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.closeBusiness;
        window.closeBusiness = async function (...args) {
            const result = await original.apply(this, args);
            resetCallNumberCounter();
            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   ③ 画面表示・音声案内
   ========================================================= */
function announceCallNumber(num) {
    if (typeof speak === 'function') {
        speak(`よびだしばんごう、 ${num}ばん です`);
    }
}

function showCallNumberToast(num) {
    const el = document.createElement('div');
    el.className = 'call-number-toast';
    el.style.cssText = [
        'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%, -50%) scale(0.9)',
        'background:#263238', 'color:#fff', 'padding:28px 44px', 'border-radius:16px',
        'box-shadow:0 12px 32px rgba(0,0,0,0.4)', 'z-index:10060', 'text-align:center',
        'opacity:0', 'transition:opacity 200ms ease, transform 200ms ease', 'cursor:pointer'
    ].join(';');
    el.innerHTML = `
        <div style="font-size:14px; color:#b0bec5; letter-spacing:0.1em; margin-bottom:6px;">よびだしばんごう</div>
        <div style="font-size:56px; font-weight:900; font-family:monospace; line-height:1;">${formatCallNumber(num)}</div>
    `;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    const dismiss = () => {
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    };

    el.addEventListener('click', dismiss);
    setTimeout(dismiss, 6000);
}
