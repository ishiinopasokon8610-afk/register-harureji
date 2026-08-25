// 返金機能用の処理
let selectedRefundIndex = null;

// 返金モードを開始（背景色を赤寄りピンクに変更＆1週間以内の履歴表示）
function openRefundModal() {
    if (typeof playSound === 'function') playSound('click');
    
    // 画面全体の背景色を赤寄りのピンクに変更
    document.body.classList.add('refund-mode');
    document.getElementById('register-screen').classList.add('refund-mode');
    
    // 過去1週間（7日以内）の会計履歴を表示
    renderWeekRefundHistory();
    
    // モーダルを表示
    document.getElementById('refund-modal').style.display = 'flex';
}

// 過去1週間（7日以内）の会計履歴をテーブルに一覧表示
function renderWeekRefundHistory() {
    const tbody = document.getElementById('refund-today-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    selectedRefundIndex = null;

    // 保存されている履歴データを取得
    const historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
    
    // 本日から7日前（0時0分）の時刻を取得
    const now = new Date();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0).getTime();

    // 7日以内のデータのみ抽出（元の配列のインデックス番号を保持）
    const weekHistory = historyData.map((item, originalIndex) => ({ ...item, originalIndex }))
        .filter(item => {
            if (!item.date) return false;
            const itemTime = new Date(item.date).getTime();
            return itemTime >= sevenDaysAgo;
        });

    if (weekHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888; padding:15px;">1週間以内の会計履歴はありません</td></tr>';
        return;
    }

    // 新しい順（日付が近い順）に並べて表示
    weekHistory.reverse().forEach((item) => {
        const d = new Date(item.date);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">
                <input type="radio" name="refund_select" value="${item.originalIndex}" onchange="selectedRefundIndex = ${item.originalIndex}">
            </td>
            <td>${dateStr}</td>
            <td>${item.clerk || '未設定'}</td>
            <td>¥${(item.total || 0).toLocaleString()}</td>
            <td>${item.payMethod || '現金'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 返金モーダルを閉じる（キャンセル時）
function closeRefundModal() {
    if (typeof playSound === 'function') playSound('click');
    document.getElementById('refund-modal').style.display = 'none';
    
    // 背景色を通常に戻す
    document.body.classList.remove('refund-mode');
    document.getElementById('register-screen').classList.remove('refund-mode');
}

// 取引選択後の「確定」ボタンを押したとき
function submitRefund() {
    if (selectedRefundIndex === null) {
        alert('返金したい取引をひとつ選択してください。');
        return;
    }

    const historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
    const targetItem = historyData[selectedRefundIndex];

    if (!targetItem) {
        alert('該当の取引データが見つかりませんでした。');
        return;
    }

    if (typeof playSound === 'function') playSound('click');

    // 一覧モーダルを閉じる
    document.getElementById('refund-modal').style.display = 'none';

    // 「〇〇円をお客様に返してください」のポップアップを表示
    const amount = (targetItem.total || 0).toLocaleString();
    document.getElementById('refund-complete-msg').innerHTML = `<b>${amount}円</b> をお客様に返してください`;
    document.getElementById('refund-complete-modal').style.display = 'flex';
}

// 「完了」を押して通常のレジ画面へ復帰 ＆ お会計履歴から対象データを削除
// ------------------------------------------
// お会計履歴の削除は店長のみ可能（履歴画面の削除と同じルール）。
// 現金を返す作業自体は担当者が行えるが、削除の実行だけは
// 店長認証（バーコード認証）を通過するまで行われない。
function finishRefundProcess() {
    const isManager = (typeof managerAuthDone !== 'undefined' && managerAuthDone) ||
        sessionStorage.getItem('pos_manager_auth') === 'true';

    if (!isManager) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof requestManagerAuth === 'function') {
            // 認証が成功すると auth-system.js 側から finalizeRefundDeletion() が呼ばれる
            requestManagerAuth('refund-delete');
        } else if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("お会計履歴の削除は店長のみ可能です。", "りれき の さくじょ は てんちょう のみ かのう です。", () => {}, false);
        }
        return;
    }

    finalizeRefundDeletion();
}

// 実際の削除・後片付け処理（店長認証済みの場合のみ呼び出される）
function finalizeRefundDeletion() {
    // 選択された取引をお会計履歴（pos_history）から削除
    if (selectedRefundIndex !== null) {
        let historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
        if (selectedRefundIndex >= 0 && selectedRefundIndex < historyData.length) {
            const targetItem = historyData[selectedRefundIndex];

            // その会計でポイントの利用・付与があった場合、会員のポイントを巻き戻す
            // （高額商品を買ってポイントだけ得てすぐ返金する、というポイント不正取得を防ぐため）
            reverseRefundPoints(targetItem);

            historyData.splice(selectedRefundIndex, 1);
            localStorage.setItem('pos_history', JSON.stringify(historyData));
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
        }
        selectedRefundIndex = null;
    }

    // 管理画面などの履歴一覧が開いている場合は表示を更新
    // （以前は存在しない renderHistoryTable() を呼んでいたため、履歴削除後も
    // 　画面が更新されない不具合があった。正しくは renderHistory()）
    if (typeof renderHistory === 'function') {
        renderHistory();
    }

    // 「本日の売上」は pos_history から都度集計しているため、返金による削除は
    // 次回の集計で自動的に反映される。ただし、売上管理・分析画面がすでに
    // 開いたまま返金した場合に表示が古いままにならないよう、その場で再集計する。
    const salesMgmtScreen = document.getElementById('sales-mgmt-screen');
    if (salesMgmtScreen && salesMgmtScreen.classList.contains('active') && typeof calculateSystemTotals === 'function') {
        calculateSystemTotals();
    }
    const analyticsScreen = document.getElementById('analytics-screen');
    if (analyticsScreen && analyticsScreen.classList.contains('active') && typeof renderAnalytics === 'function') {
        renderAnalytics();
    }

    if (typeof playSound === 'function') playSound('success');

    // ポップアップを閉じる
    const completeModal = document.getElementById('refund-complete-modal');
    if (completeModal) completeModal.style.display = 'none';

    // 背景色を通常に戻す
    document.body.classList.remove('refund-mode');
    const registerScreen = document.getElementById('register-screen');
    if (registerScreen) registerScreen.classList.remove('refund-mode');
}

// 返金対象の取引にひもづく会員のポイントを、会計前の状態に巻き戻す。
// ・その会計で「使ったポイント（pointsUsed）」→ 会員に戻す（プラス）
// ・その会計で「付与したポイント（pointsEarned）」→ 取り消す（マイナス）
// 古いデータ（このフィールドを追加する前に会計されたもの）には
// pointsUsed / pointsEarned が存在しないため、その場合は何もしない。
function reverseRefundPoints(targetItem) {
    if (!targetItem || !targetItem.customerBarcode) return;
    if (typeof customers === 'undefined' || !Array.isArray(customers)) return;

    const pointsUsed = targetItem.pointsUsed || 0;
    const pointsEarned = targetItem.pointsEarned || 0;
    if (pointsUsed === 0 && pointsEarned === 0) return;

    const idx = customers.findIndex(c => c.barcode === targetItem.customerBarcode);
    if (idx === -1) return;

    const cust = customers[idx];
    cust.points = (cust.points || 0) + pointsUsed - pointsEarned;
    if (cust.points < 0) cust.points = 0; // マイナス残高にはしない
    cust.pointsUpdatedAt = new Date().toISOString();

    // ランク判定に使う年間購入額からも、この会計分（返金額＝total）を差し引く
    if (typeof cust.annualPurchase === 'number') {
        cust.annualPurchase = Math.max(0, cust.annualPurchase - (targetItem.total || 0));
    }

    customers[idx] = cust;
    localStorage.setItem('pos_customers', JSON.stringify(customers));

    // 今まさにその会員を会計画面に呼び出している最中であれば、表示中の情報も更新する
    if (typeof activeCustomer !== 'undefined' && activeCustomer && activeCustomer.barcode === cust.barcode) {
        activeCustomer = cust;
        const acPoints = document.getElementById('ac-points');
        if (acPoints) acPoints.innerText = cust.points;
    }
}