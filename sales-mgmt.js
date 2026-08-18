// ==========================================
// ハイテク音声レジスター - 売上管理・精算機能
// ==========================================

let isBusinessClosed = false;
let calculatedSystemTotal = 0; 
let cashlessTotal = 0;         

// 業務を再開（開始）する（準備金入力モーダルを開く）
function startBusiness() {
    if (typeof playSound === 'function') playSound('click');
    
    // 黒い終了オーバーレイを非表示にする
    const overlay = document.getElementById('business-closed-overlay');
    if (overlay) overlay.style.display = 'none';

    const modal = document.getElementById('business-start-modal');
    if (modal) modal.style.display = 'flex';
    document.querySelectorAll('.start-cash-input').forEach(input => input.value = '');
    document.getElementById('start-total-display').innerText = '¥0';
    if (typeof speak === 'function') speak("つりせん じゅんびきん を にゅうりょく し て ください");
}

// 準備金入力をキャンセルした時
function closeStartBusiness() {
    const modal = document.getElementById('business-start-modal');
    if (modal) modal.style.display = 'none';
    checkBusinessStatus();
}

// 準備金（釣銭）の入力計算
function calculateStartCash() {
    let total = 0;
    const values = {
        10000: parseInt(document.getElementById('start-10000').value) || 0,
        5000: parseInt(document.getElementById('start-5000').value) || 0,
        1000: parseInt(document.getElementById('start-1000').value) || 0,
        500: parseInt(document.getElementById('start-500').value) || 0,
        100: parseInt(document.getElementById('start-100').value) || 0,
        50: parseInt(document.getElementById('start-50').value) || 0,
        10: parseInt(document.getElementById('start-10').value) || 0,
        5: parseInt(document.getElementById('start-5').value) || 0,
        1: parseInt(document.getElementById('start-1').value) || 0
    };

    for (const [denomination, count] of Object.entries(values)) {
        total += parseInt(denomination) * count;
    }

    document.getElementById('start-total-display').innerText = `¥${total.toLocaleString()}`;
    return total;
}

// 業務開始の確定
function confirmStartBusiness() {
    const totalStartCash = calculateStartCash();
    localStorage.setItem('pos_start_cash', totalStartCash);
    localStorage.removeItem('pos_business_closed');
    isBusinessClosed = false;

    const overlay = document.getElementById('business-closed-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    if (typeof ablyChannel !== 'undefined' && ablyChannel) {
        ablyChannel.publish('business-status', { status: 'open', time: Date.now() }).catch(() => {});
    }

    if (typeof playSound === 'function') playSound('success');
    document.getElementById('business-start-modal').style.display = 'none';
    if (typeof speak === 'function') speak(`ぎょうむ を さいかい し ます。 じゅんびきん は ${totalStartCash} えん です`);
    checkBusinessStatus();
}

// 売上管理（精算）画面を開く
function openSalesMgmtScreen() {
    if (typeof playSound === 'function') playSound('click');
    if (typeof showScreen === 'function') showScreen('sales-mgmt-screen');
    
    calculateSystemTotals();
    
    document.querySelectorAll('.end-cash-input').forEach(input => input.value = '');
    document.getElementById('end-total-display').innerText = '¥0';
    document.getElementById('diff-display').innerText = '¥0';
    document.getElementById('diff-display').style.color = '#333';
    
    const logoutBtn = document.getElementById('btn-close-business');
    if (logoutBtn) logoutBtn.disabled = true;

    if (typeof speak === 'function') speak("うりあげ かんり 画面 です。 げんきん を 数え て 入力 し て ください");
}

function calculateSystemTotals() {
    const historyData = JSON.parse(localStorage.getItem('pos_history') || '[]');
    const todayStr = new Date().toLocaleDateString('ja-JP');
    const startCash = parseInt(localStorage.getItem('pos_start_cash')) || 0;

    let cashSales = 0;
    cashlessTotal = 0;

    historyData.forEach(item => {
        const itemDate = item.date ? new Date(item.date).toLocaleDateString('ja-JP') : null;
        if (itemDate === todayStr) {
            if (item.payMethod === '現金' || item.payment === '現金') {
                cashSales += parseInt(item.total) || 0;
            } else if (item.payMethod !== '全額ポイント' && item.payment !== '全額ポイント') {
                cashlessTotal += parseInt(item.total) || 0;
            }
        }
    });

    calculatedSystemTotal = startCash + cashSales;

    document.getElementById('system-cash-display').innerText = `¥${calculatedSystemTotal.toLocaleString()}`;
    document.getElementById('system-cashless-display').innerText = `¥${cashlessTotal.toLocaleString()}`;
}

function calculateEndCash() {
    let actualTotal = 0;
    const values = {
        10000: parseInt(document.getElementById('end-10000').value) || 0,
        5000: parseInt(document.getElementById('end-5000').value) || 0,
        1000: parseInt(document.getElementById('end-1000').value) || 0,
        500: parseInt(document.getElementById('end-500').value) || 0,
        100: parseInt(document.getElementById('end-100').value) || 0,
        50: parseInt(document.getElementById('end-50').value) || 0,
        10: parseInt(document.getElementById('end-10').value) || 0,
        5: parseInt(document.getElementById('end-5').value) || 0,
        1: parseInt(document.getElementById('end-1').value) || 0
    };

    for (const [denomination, count] of Object.entries(values)) {
        actualTotal += parseInt(denomination) * count;
    }

    const diff = actualTotal - calculatedSystemTotal;
    const diffDisplay = document.getElementById('diff-display');
    const logoutBtn = document.getElementById('btn-close-business');

    document.getElementById('end-total-display').innerText = `¥${actualTotal.toLocaleString()}`;

    if (diff === 0) {
        diffDisplay.innerText = '± ¥0';
        diffDisplay.style.color = '#2e7d32'; 
        if (logoutBtn) logoutBtn.disabled = false; 
    } else if (diff > 0) {
        diffDisplay.innerText = `+ ¥${diff.toLocaleString()} (過剰)`;
        diffDisplay.style.color = '#1565c0'; 
        if (logoutBtn) logoutBtn.disabled = true;
    } else {
        diffDisplay.innerText = `- ¥${Math.abs(diff).toLocaleString()} (不足)`;
        diffDisplay.style.color = '#d32f2f'; 
        if (logoutBtn) logoutBtn.disabled = true;
    }

    return diff;
}

// 業務終了（ログアウト）ボタンを押した時（0円のときOKを押すとレシートがPNG保存される）
function closeBusiness() {
    if (typeof playSound === 'function') playSound('click');
    
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("過不足は0円です。本日の業務を終了しログアウトしますか？", "ほんじつ の ぎょうむ を しゅうりょう し ます か？", (res) => {
            if (!res) return;
            
            localStorage.setItem('pos_business_closed', 'true');
            isBusinessClosed = true;

            checkBusinessStatus();

            if (typeof ablyChannel !== 'undefined' && ablyChannel) {
                ablyChannel.publish('business-status', { status: 'closed', time: Date.now() }).catch(() => {});
            }

            // 本日の精算・売上内容のレシートをPNG画像として自動保存する
            const salesMgmtScreen = document.getElementById('sales-mgmt-screen');
            if (salesMgmtScreen && typeof html2canvas !== 'undefined') {
                html2canvas(salesMgmtScreen).then(canvas => {
                    const link = document.createElement('a');
                    const todayStr = new Date().toISOString().slice(0, 10);
                    link.download = `精算レシート_${todayStr}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                }).catch(err => {
                    console.error("レシートの画像保存に失敗しました", err);
                });
            }

            if (typeof playSound === 'function') playSound('success');
            if (typeof speak === 'function') speak("ほんじつ の ぎょうむ は しゅうりょう し まし た。 レシート を ほぞん し まし た");
        }, true);
    }
}

function checkBusinessStatus() {
    const isClosedStr = localStorage.getItem('pos_business_closed');
    isBusinessClosed = (isClosedStr === 'true');

    const overlay = document.getElementById('business-closed-overlay');
    if (overlay) {
        if (isBusinessClosed) {
            overlay.style.display = 'flex';
        } else {
            overlay.style.display = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkBusinessStatus();

    const setupAblySync = () => {
        if (typeof ablyChannel !== 'undefined' && ablyChannel) {
            ablyChannel.subscribe('business-status', (message) => {
                if (message.data.status === 'closed') {
                    localStorage.setItem('pos_business_closed', 'true');
                    isBusinessClosed = true;
                    checkBusinessStatus();
                } else if (message.data.status === 'open') {
                    localStorage.removeItem('pos_business_closed');
                    isBusinessClosed = false;
                    checkBusinessStatus();
                }
            });
        } else {
            setTimeout(setupAblySync, 1000);
        }
    };
    setupAblySync();

    window.addEventListener('storage', (e) => {
        if (e.key === 'pos_business_closed') {
            checkBusinessStatus();
        }
    });
});