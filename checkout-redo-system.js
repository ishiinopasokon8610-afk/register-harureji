// ==========================================
// checkout-redo-system.js
// 「会計やり直し」機能
// ------------------------------------------
// 取引番号（history-receipt-number-system.js が発行する receiptNo。例: R000123）を
// 入力すると、その時にカートに入っていた商品を「今スキャンしたかのように」
// レジ画面（receipt-body）にそのまま読み込む。
// 読み込んだ後は、通常の操作（バーコード追加・選択して取消・数量変更・半額など）で
// 自由に内容を直し、最後に通常どおり「お会計」ボタンから会計を完了させる。
//
// 通常なら completeTransaction() は新しい取引として履歴に追加されるが、
// 「会計やり直し」モード中に完了した場合は、新規追加された分を元の取引
// （同じ取引番号）に上書きし、新規追加分は取り消す（＝上書き保存になる）。
//
// register.js / ui.js は直接編集せず、既存のシステムと同じ「フック方式」で実現する。
// ==========================================

let redoCheckoutTargetReceiptNo = null;

/* ---------- 起動・キャンセル ---------- */

// ヘッダーの「会計やり直し」ボタン。
// 通常時：取引番号入力モーダルを開く。
// やり直しモード中：モードをキャンセルするか確認する。
function openRedoCheckoutModal() {
    if (redoCheckoutTargetReceiptNo) {
        if (typeof playSound === 'function') playSound('click');
        showConfirmSafe(
            `会計やり直しをキャンセルしますか？（取引番号: ${redoCheckoutTargetReceiptNo}）\n読み込んだ内容はレジ画面から消えます。`,
            'かいけい やりなおし を キャンセル し ます か？',
            (res) => { if (res) cancelRedoCheckoutMode(); else if (typeof focusJanInput === 'function') focusJanInput(); },
            true
        );
        return;
    }

    const input = document.getElementById('redo-checkout-no-input');
    if (input) input.value = '';
    const modal = document.getElementById('redo-checkout-lookup-modal');
    if (modal) modal.style.display = 'flex';
    if (typeof playSound === 'function') playSound('click');
    setTimeout(() => { if (input) input.focus(); }, 50);
}

function closeRedoCheckoutLookupModal() {
    const modal = document.getElementById('redo-checkout-lookup-modal');
    if (modal) modal.style.display = 'none';
    if (typeof focusJanInput === 'function') focusJanInput();
}

function getHistoryListSafe() {
    try {
        return JSON.parse(localStorage.getItem('pos_history') || '[]');
    } catch (e) {
        return [];
    }
}

function showConfirmSafe(msg, kana, cb, alertOnly) {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(msg, kana, cb, alertOnly);
    } else {
        const res = confirm(msg);
        if (typeof cb === 'function') cb(res);
    }
}

/* ---------- 取引番号の検索 → レジ画面へ読み込み ---------- */

// 「R000123」の「R」を毎回打つのは手間なので、数字だけの入力
// （例: "123" や "000123"）でも同じ取引を検索できるようにする。
// 大文字小文字・前後の空白・「R」の有無を吸収し、最終的に
// history-receipt-number-system.js が発行する形式（R+6桁）に揃える。
function normalizeReceiptNoInput(raw) {
    const digits = (raw || '').replace(/[^0-9]/g, '');
    if (!digits) return '';
    return 'R' + digits.padStart(6, '0');
}

function searchRedoCheckoutTarget() {
    const input = document.getElementById('redo-checkout-no-input');
    const no = input ? normalizeReceiptNoInput(input.value) : '';

    if (!no) {
        if (typeof playSound === 'function') playSound('error');
        showConfirmSafe('取引番号を入力してください。', 'とりひきばんごう を にゅうりょく し て ください。', () => {}, true);
        return;
    }

    const historyList = getHistoryListSafe();
    const record = historyList.find(r => r.receiptNo === no);

    if (!record) {
        if (typeof playSound === 'function') playSound('error');
        showConfirmSafe(`取引番号「${no}」の会計が見つかりませんでした。`, 'とりひきばんごう の かいけい が みつかり ませ ん でし た。', () => {}, true);
        return;
    }

    closeRedoCheckoutLookupModal();
    loadRedoCheckoutIntoRegister(record);
}

// 過去の取引をレジ画面に「今スキャンしたかのように」読み込む
function loadRedoCheckoutIntoRegister(record) {
    // 元に戻す（アンドゥ）用に、読み込む前のカートの状態を残しておく
    if (typeof recordCartState === 'function') recordCartState();

    cart = JSON.parse(JSON.stringify(record.cartSnapshot || []));
    currentDeposit = 0;
    currentChange = 0;
    usedPoints = 0;
    selectedPayment = '現金';
    lastScannedBarcode = '';

    redoCheckoutTargetReceiptNo = record.receiptNo;

    if (typeof updateReceipt === 'function') updateReceipt();
    updateRedoCheckoutButtonUI();

    if (typeof speak === 'function') speak(`取引番号 ${record.receiptNo} の内容を読み込みました。内容を直したら、お会計ボタンを押してください。`);
    if (typeof playSound === 'function') playSound('success');
    if (typeof focusJanInput === 'function') focusJanInput();
}

function updateRedoCheckoutButtonUI() {
    const btn = document.getElementById('redo-checkout-btn');
    if (!btn) return;
    if (redoCheckoutTargetReceiptNo) {
        btn.innerText = `やり直し中: ${redoCheckoutTargetReceiptNo}（取消）`;
        btn.style.background = '#c62828';
    } else {
        btn.innerText = '会計やり直し';
        btn.style.background = '#f57c00';
    }
}

function cancelRedoCheckoutMode() {
    cart = [];
    currentDeposit = 0;
    currentChange = 0;
    usedPoints = 0;
    billingAmount = 0;
    selectedPayment = '現金';

    if (typeof updateReceipt === 'function') updateReceipt();

    redoCheckoutTargetReceiptNo = null;
    updateRedoCheckoutButtonUI();

    if (typeof speak === 'function') speak('かいけい やりなおし を キャンセル し まし た');
    if (typeof focusJanInput === 'function') focusJanInput();
}

/* ---------- 会計完了フック：新規追加分を元の取引に上書きする ---------- */

(function hookRedoCheckoutIntoCompleteTransaction() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            const wasRedo = !!redoCheckoutTargetReceiptNo;
            const redoTargetNo = redoCheckoutTargetReceiptNo;

            const result = await original.apply(this, args);

            if (wasRedo) {
                try {
                    mergeRedoCheckoutResultIntoOriginal(redoTargetNo);
                } catch (e) {
                    console.warn('会計やり直しの上書き保存に失敗しました:', e);
                } finally {
                    redoCheckoutTargetReceiptNo = null;
                    updateRedoCheckoutButtonUI();
                }
            }

            return result;
        };
    }
    tryHook();
})();

// completeTransaction() が新しく先頭に追加した取引（今回やり直しで作られた分）を、
// 元の取引（同じ取引番号を持つ既存レコード）へ上書きし、新規追加分は取り除く。
function mergeRedoCheckoutResultIntoOriginal(redoTargetNo) {
    let historyList = getHistoryListSafe();
    if (historyList.length === 0) return;

    // 今回 completeTransaction() が作った新しいレコード（先頭）
    const newRecord = historyList[0];
    if (!newRecord || newRecord.receiptNo === redoTargetNo) return; // 想定外：すでに同じ番号なら何もしない

    // 元のレコード（新規追加分より後ろにあるはず）
    const oldIdx = historyList.findIndex((r, i) => i > 0 && r.receiptNo === redoTargetNo);
    if (oldIdx === -1) {
        // 元のレコードが見つからない（他端末で削除された等）場合は、
        // 新規追加分をそのまま独立した取引として残す（データを失わないため）。
        return;
    }

    const oldRecord = historyList[oldIdx];

    // 内容を新しい会計結果で上書きする（取引番号・日時・IDは元のまま保持）
    oldRecord.total = newRecord.total;
    oldRecord.deposit = newRecord.deposit;
    oldRecord.change = newRecord.change;
    oldRecord.payment = newRecord.payment;
    oldRecord.items = newRecord.items;
    oldRecord.cartSnapshot = newRecord.cartSnapshot;
    oldRecord.clerk = newRecord.clerk;
    oldRecord.customerBarcode = newRecord.customerBarcode;
    oldRecord.customerAge = newRecord.customerAge;
    oldRecord.customerGender = newRecord.customerGender;
    oldRecord.pointsUsed = newRecord.pointsUsed;
    oldRecord.pointsEarned = newRecord.pointsEarned;
    oldRecord.edited = true;
    oldRecord.editedAt = new Date().toISOString();

    // 税区分内訳（tax-report-system.js）もカート内容の変更に合わせて再計算する。
    // 上書き後の内容とズレないよう、コピーではなく最新のcartSnapshotから計算し直す。
    if (typeof computeTaxBreakdownFromItems === 'function') {
        const breakdown = computeTaxBreakdownFromItems(oldRecord.cartSnapshot);
        oldRecord.tax10Total = breakdown.tax10Total;
        oldRecord.tax8Total = breakdown.tax8Total;
        oldRecord.taxFreeTotal = breakdown.taxFreeTotal;
    }

    // 新規追加分（重複）を履歴から取り除く
    historyList.shift();

    // 万一、新規追加分が一瞬でも他端末へ同期されていた場合に備え、削除記録（tombstone）も残しておく
    if (typeof recordDeletedHistory === 'function') {
        const newRecordKey = newRecord.id || newRecord.dateISO || newRecord.date;
        recordDeletedHistory(newRecordKey, Date.now());
    }

    localStorage.setItem('pos_history', JSON.stringify(historyList));
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof window.renderHistory === 'function') window.renderHistory();
}
