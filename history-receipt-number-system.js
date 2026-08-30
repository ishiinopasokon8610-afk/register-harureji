// ==========================================
// history-receipt-number-system.js
// お会計履歴・レシートへの「取引番号」付与機能
// ------------------------------------------
// お会計が完了するたびに、連番の「取引番号」（例: R000123）を発行し、
//   ①お会計履歴一覧（#history-tbody）に列として表示
//   ②レシート（画面表示・PNG保存の両方）の下の方に印字
// する。member-number-system.js（会員番号）と同じ考え方・同じ「フック方式」。
//
// 【採番の重複防止（複数端末対応）】
// member-number-system.js と全く同じ方式：
//   1. 採番カウンター(pos_receipt_no_counter)を各端末のlocalStorageに保持
//   2. 発行と同時にAblyで他端末へ新しいカウンター値をブロードキャスト
//   3. 他端末はカウンターを受信したら「大きい方の値」を採用（常に増加方向のみ）
//
// register.js / auth-system.js は直接編集せず、
//   ・completeTransaction() をフックして、会計完了直後に採番
//   ・generateReceiptHTML() をフックして、レシート下部に印字
//   ・renderHistory() をフックして、履歴一覧に列を追加
// という「フック方式」で実現する。
// ==========================================

const RECEIPT_NO_COUNTER_KEY = 'pos_receipt_no_counter';
const RECEIPT_NO_PREFIX = 'R';
const RECEIPT_NO_DIGITS = 6;

function getReceiptNoCounter() {
    return parseInt(localStorage.getItem(RECEIPT_NO_COUNTER_KEY), 10) || 0;
}

// カウンターは常に増加方向にしか動かさない（他端末からの古い値で巻き戻さない）
function setReceiptNoCounter(value, broadcast) {
    if (broadcast === undefined) broadcast = true;
    const current = getReceiptNoCounter();
    if (value <= current) return;
    localStorage.setItem(RECEIPT_NO_COUNTER_KEY, String(value));
    if (broadcast) broadcastReceiptNoCounter(value);
}

function formatReceiptNo(n) {
    return RECEIPT_NO_PREFIX + String(n).padStart(RECEIPT_NO_DIGITS, '0');
}

// 新しい取引番号を1つ発行する（採番と同時にカウンターを進めて他端末へ通知する）
function issueNewReceiptNo() {
    const next = getReceiptNoCounter() + 1;
    setReceiptNoCounter(next, true);
    return formatReceiptNo(next);
}

/* =========================================================
   API（Ably）経由でのカウンター同期
   ========================================================= */
function broadcastReceiptNoCounter(value) {
    if (typeof channel !== 'undefined' && channel) {
        try {
            channel.publish('receipt-no-counter-sync', {
                counter: value,
                senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null,
                time: Date.now()
            });
        } catch (err) {
            console.warn('取引番号カウンターの同期送信に失敗しました:', err);
        }
    }
}

(function waitForChannelAndSubscribeReceiptNoSync() {
    if (typeof channel !== 'undefined' && channel) {
        channel.subscribe('receipt-no-counter-sync', (msg) => {
            if (msg && msg.data && typeof msg.data.counter === 'number') {
                // 受信した値をそのまま反映する（再送信はしない＝無限ループ防止）
                setReceiptNoCounter(msg.data.counter, false);
            }
        });
    } else {
        setTimeout(waitForChannelAndSubscribeReceiptNoSync, 500);
    }
})();

/* =========================================================
   フック①：お会計完了時に、その場でできた履歴レコードへ採番する
   ------------------------------------------
   completeTransaction() は関数内部でレコードを作って直接
   localStorage(pos_history) に保存しているため割り込めない。
   そこで checkout-demographics.js と同じ「保存前後で件数が
   増えていたら、先頭（今回のレコード）に追記する」方式をとる。
   ========================================================= */
(function hookReceiptNoIntoCompleteTransaction() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            const beforeList = JSON.parse(localStorage.getItem('pos_history') || '[]');
            const beforeCount = beforeList.length;

            const result = await original.apply(this, args);

            try {
                const afterList = JSON.parse(localStorage.getItem('pos_history') || '[]');
                if (afterList.length > beforeCount && !afterList[0].receiptNo) {
                    afterList[0].receiptNo = issueNewReceiptNo();
                    localStorage.setItem('pos_history', JSON.stringify(afterList));
                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                }
            } catch (e) {
                console.warn('取引番号の付与に失敗しました:', e);
            }

            return result;
        };
    }
    tryHook();
})();

/* =========================================================
   フック②：レシート（画面表示・PNG保存の両方の元になるDOM）の
   下の方に取引番号を印字する
   ------------------------------------------
   generateReceiptHTML() は毎回 content.innerHTML を丸ごと
   作り直すため、実行後にDOM側から1行追加で差し込む。
   フック①の採番が（ごく僅かなタイミング差で）まだ終わっていない
   場合に備え、ここでも「なければその場で採番する」保険をかけている。
   ========================================================= */
(function hookReceiptNoIntoReceipt() {
    function tryHook() {
        if (typeof window.generateReceiptHTML !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.generateReceiptHTML;
        window.generateReceiptHTML = function (...args) {
            const result = original.apply(this, args);
            appendReceiptNoToReceipt();
            return result;
        };
    }
    tryHook();
})();

function appendReceiptNoToReceipt() {
    const content = document.getElementById('print-receipt-content');
    if (!content) return;

    let historyList = [];
    try { historyList = JSON.parse(localStorage.getItem('pos_history') || '[]'); } catch (e) { return; }
    if (historyList.length === 0) return;

    // 直近の取引（今回発行したレシート）に採番されていなければ、表示直前の保険としてその場で採番する
    if (!historyList[0].receiptNo) {
        historyList[0].receiptNo = issueNewReceiptNo();
        localStorage.setItem('pos_history', JSON.stringify(historyList));
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    }

    const div = document.createElement('div');
    div.id = 'receipt-no-row';
    div.style.cssText = 'text-align:center; font-size:12px; color:#555; margin-top:10px;';
    div.innerText = `取引番号: ${historyList[0].receiptNo}`;
    content.appendChild(div);
}

/* =========================================================
   フック③：お会計履歴一覧（#history-tbody）に「取引番号」列を追加する
   ------------------------------------------
   member-number-system.js の会員一覧への列追加と同じ方式。
   renderHistory()はtbodyの中身を1から作り直す関数のため、
   実行後にDOM側から1列（先頭）を追加で差し込む。
   ========================================================= */
(function hookReceiptNoIntoRenderHistory() {
    function tryHook() {
        if (typeof window.renderHistory !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const originalRenderHistory = window.renderHistory;
        window.renderHistory = function (...args) {
            const result = originalRenderHistory.apply(this, args);
            injectReceiptNoColumn();
            return result;
        };
    }
    tryHook();
})();

function injectReceiptNoColumn() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    let historyList = [];
    try { historyList = JSON.parse(localStorage.getItem('pos_history') || '[]'); } catch (e) { return; }

    // ヘッダーに「取引番号」列が無ければ、選択列の直後に追加する
    const table = tbody.closest('table');
    const headerRow = table ? table.querySelector('thead tr') : null;
    if (headerRow && !headerRow.querySelector('.receipt-no-header')) {
        const th = document.createElement('th');
        th.className = 'receipt-no-header';
        th.innerText = '取引番号';
        const selectHeader = headerRow.querySelector('.history-select-col');
        if (selectHeader && selectHeader.nextSibling) {
            headerRow.insertBefore(th, selectHeader.nextSibling);
        } else {
            headerRow.insertBefore(th, headerRow.firstChild);
        }
    }

    Array.from(tbody.children).forEach((tr, i) => {
        if (tr.querySelector('td[colspan]')) return; // プレースホルダー行はスキップ
        if (tr.querySelector('.receipt-no-cell')) return; // すでに追加済み
        const rec = historyList[i];
        if (!rec) return;
        const td = document.createElement('td');
        td.className = 'receipt-no-cell';
        td.style.cssText = 'font-family:monospace; font-weight:bold; color:#0277bd; white-space:nowrap;';
        td.innerText = rec.receiptNo || '(未採番)';
        // 選択チェックボックスの列（1列目）の直後に挿入
        const firstCell = tr.children[0];
        if (firstCell && firstCell.nextSibling) {
            tr.insertBefore(td, firstCell.nextSibling);
        } else {
            tr.insertBefore(td, tr.firstChild);
        }
    });
}

/* =========================================================
   フック④：バックアップ（ローカルファイル／Google Drive）にも
   取引番号カウンター・削除記録（tombstone）を含める
   ------------------------------------------
   auth-system.js の buildAllDataObject() / applyImportedDataObject() は
   直接編集せず、既存の member-number-system.js と同じ考え方で、
   会員番号カウンターと同様にこちらも追加項目として乗せる。
   ========================================================= */
(function hookReceiptNoIntoBackup() {
    function tryHook() {
        if (typeof window.buildAllDataObject !== 'function' || typeof window.applyImportedDataObject !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const originalBuild = window.buildAllDataObject;
        window.buildAllDataObject = function (...args) {
            const result = originalBuild.apply(this, args);
            result.receiptNoCounter = localStorage.getItem(RECEIPT_NO_COUNTER_KEY) || '';
            result.deletedHistory = JSON.parse(localStorage.getItem('pos_deleted_history') || '[]');
            return result;
        };

        const originalApply = window.applyImportedDataObject;
        window.applyImportedDataObject = function (dataObj, options) {
            const result = originalApply.apply(this, [dataObj, options]);
            if (dataObj && dataObj.receiptNoCounter !== undefined && dataObj.receiptNoCounter !== '') {
                setReceiptNoCounter(parseInt(dataObj.receiptNoCounter, 10) || 0, false);
            }
            if (dataObj && Array.isArray(dataObj.deletedHistory)) {
                localStorage.setItem('pos_deleted_history', JSON.stringify(dataObj.deletedHistory));
            }
            return result;
        };
    }
    tryHook();
})();
