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
function finishRefundProcess() {
    // 選択された取引をお会計履歴（pos_history）から削除
    if (selectedRefundIndex !== null) {
        let historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
        if (selectedRefundIndex >= 0 && selectedRefundIndex < historyData.length) {
            historyData.splice(selectedRefundIndex, 1);
            localStorage.setItem('pos_history', JSON.stringify(historyData));
        }
        selectedRefundIndex = null;
    }

    // 管理画面などの履歴一覧が開いている場合は表示を更新
    if (typeof renderHistoryTable === 'function') {
        renderHistoryTable();
    }

    if (typeof playSound === 'function') playSound('success');

    // ポップアップを閉じる
    document.getElementById('refund-complete-modal').style.display = 'none';

    // 背景色を通常に戻す
    document.body.classList.remove('refund-mode');
    document.getElementById('register-screen').classList.remove('refund-mode');
}