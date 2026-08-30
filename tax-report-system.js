// ==========================================
// tax-report-system.js
// 「免税適用」した取引の売上集計（消費税申告）の区分
// ------------------------------------------
// お会計履歴（pos_history）の各取引データに、必ず
//   tax10Total   … 10%対象売上（税込）
//   tax8Total    …  8%対象売上（税込）
//   taxFreeTotal … 免税（0%）対象売上
// の3プロパティを持たせる（cartSnapshotのitem.taxRateから算出）。
// これにより、確定申告・消費税申告の際に「免税売上がいくらだったか」を
// 後から集計できるようにする。
//
// register.js は直接編集せず、completeTransaction() をフックして
// 会計完了時に付与する（history-receipt-number-system.js と同じ方式）。
// また、sales-mgmt.js の calculateSystemTotals()（精算画面）をフックし、
// 本日の売上を「10%対象／8%対象／免税対象」に分けて表示する。
// ==========================================

// cartSnapshot（カートの商品配列）から、税区分ごとの小計を計算する。
// register.js の updateReceipt() 内にある集計ロジック（total8/total10/total0）と同じ考え方。
// 会計やり直し（checkout-redo-system.js）が内容を上書きした後の再計算にも使えるよう、
// 共通の関数として切り出してある。
function computeTaxBreakdownFromItems(items) {
    let tax10Total = 0;
    let tax8Total = 0;
    let taxFreeTotal = 0;

    (items || []).forEach(item => {
        const subTotal = (Number(item.price) || 0) * (Number(item.qty) || 0);
        if (item.taxRate === 8) {
            tax8Total += subTotal;
        } else if (item.taxRate === 0) {
            taxFreeTotal += subTotal;
        } else {
            tax10Total += subTotal;
        }
    });

    return { tax10Total, tax8Total, taxFreeTotal };
}

function getHistoryListSafeForTaxReport() {
    try {
        return JSON.parse(localStorage.getItem('pos_history') || '[]');
    } catch (e) {
        return [];
    }
}

/* ---------- フック①：会計完了時に税区分の内訳を記録する ---------- */
(function hookTaxBreakdownIntoCompleteTransaction() {
    function tryHook() {
        if (typeof window.completeTransaction !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.completeTransaction;
        window.completeTransaction = async function (...args) {
            const beforeList = getHistoryListSafeForTaxReport();
            const beforeCount = beforeList.length;

            const result = await original.apply(this, args);

            try {
                const afterList = getHistoryListSafeForTaxReport();
                if (afterList.length > beforeCount && afterList[0].taxFreeTotal === undefined) {
                    const breakdown = computeTaxBreakdownFromItems(afterList[0].cartSnapshot);
                    afterList[0].tax10Total = breakdown.tax10Total;
                    afterList[0].tax8Total = breakdown.tax8Total;
                    afterList[0].taxFreeTotal = breakdown.taxFreeTotal;
                    localStorage.setItem('pos_history', JSON.stringify(afterList));
                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                }
            } catch (e) {
                console.warn('税区分内訳の記録に失敗しました:', e);
            }

            return result;
        };
    }
    tryHook();
})();

/* ---------- 精算画面：本日の売上を税区分ごとに表示する ---------- */

function renderTodayTaxBreakdown() {
    const el10 = document.getElementById('tax-report-10-display');
    const el8 = document.getElementById('tax-report-8-display');
    const elFree = document.getElementById('tax-report-free-display');
    if (!el10 && !el8 && !elFree) return; // このUIが無い画面では何もしない

    const historyList = getHistoryListSafeForTaxReport();
    const todayStr = new Date().toLocaleDateString('ja-JP');

    let tax10 = 0, tax8 = 0, taxFree = 0;

    historyList.forEach(rec => {
        const recDate = rec.date ? new Date(rec.date).toLocaleDateString('ja-JP') : null;
        if (recDate !== todayStr) return;

        // 新しい取引（taxFreeTotal等がすでに記録済み）はそのまま使い、
        // 古い取引（この機能導入前のデータ）は cartSnapshot から都度計算する（後方互換）。
        if (rec.taxFreeTotal !== undefined && rec.tax8Total !== undefined && rec.tax10Total !== undefined) {
            tax10 += rec.tax10Total;
            tax8 += rec.tax8Total;
            taxFree += rec.taxFreeTotal;
        } else {
            const breakdown = computeTaxBreakdownFromItems(rec.cartSnapshot);
            tax10 += breakdown.tax10Total;
            tax8 += breakdown.tax8Total;
            taxFree += breakdown.taxFreeTotal;
        }
    });

    if (el10) el10.innerText = `¥${tax10.toLocaleString()}`;
    if (el8) el8.innerText = `¥${tax8.toLocaleString()}`;
    if (elFree) elFree.innerText = `¥${taxFree.toLocaleString()}`;
}

(function hookTaxBreakdownIntoSalesMgmt() {
    function tryHook() {
        if (typeof window.calculateSystemTotals !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.calculateSystemTotals;
        window.calculateSystemTotals = function (...args) {
            const result = original.apply(this, args);
            renderTodayTaxBreakdown();
            return result;
        };
    }
    tryHook();
})();
