// ==========================================
// ハイテク音声レジスター - 売上管理・精算機能
// ==========================================

// 【今回の修正】業務の開始・終了（チェックアウト）が、他の端末に伝わっていなかった。
// 原因：送受信に使っていた ablyChannel は、Ablyをやめた時点で存在しなくなっており、
// どちらも「何もしない」状態になっていた。現在の同期の窓口である channel
// （firebase-sync-system.js）に切り替えた。
//   ・業務終了：他の端末も「本日の業務を終了しました」の画面になる
//     （PNGレシートの自動保存は、終了操作をした端末だけが行う）
//   ・業務開始：他の端末も開始状態に戻り、釣銭準備金も同じ金額になる
//   ・過不足の記録（pos_last_close_diff）も、終了した端末のものが他の端末に入る
// あわせて、pos_business_closed / pos_start_cash などの保存値は
// extra-settings-sync.js でも同期されるので、通信が途切れていた端末も、後から追いつく。
let isBusinessClosed = false;

// 業務の開始・終了を、他の端末へ知らせる
function broadcastBusinessStatus(payload) {
    if (typeof channel === 'undefined' || !channel) return;
    try {
        channel.publish('business-status', Object.assign({
            time: Date.now(),
            senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null
        }, payload));
    } catch (e) {
        console.warn('業務状態の同期送信に失敗しました:', e);
    }
}
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
    document.querySelectorAll('#business-start-modal .cash-row-subtotal').forEach(el => el.innerText = '¥0');
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
// 各入力欄は「金額」ではなく「枚数」を入力する仕様。
// 金種（denomination）× 入力された枚数（count）＝ 金額 を自動計算する。
// 疲れたスタッフが「枚数のつもりで金額を打ってしまう／掛け算を間違える」ことによる
// 過不足（違算）を防ぐため、金種ごとの内訳（小計）も横に表示する。
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
        const subtotal = parseInt(denomination) * count;
        total += subtotal;
        const subEl = document.getElementById(`start-${denomination}-sub`);
        if (subEl) subEl.innerText = `¥${subtotal.toLocaleString()}`;
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

    broadcastBusinessStatus({ status: 'open', startCash: totalStartCash });

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
    document.querySelectorAll('#sales-mgmt-screen .cash-row-subtotal').forEach(el => el.innerText = '¥0');
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

// レジ内現金の実査カウント（精算時）。
// こちらも start 側と同様、入力欄は「枚数」。金種ごとの金額（小計）を横に表示して
// 入力ミスにすぐ気付けるようにする。
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
        const subtotal = parseInt(denomination) * count;
        actualTotal += subtotal;
        const subEl = document.getElementById(`end-${denomination}-sub`);
        if (subEl) subEl.innerText = `¥${subtotal.toLocaleString()}`;
    }

    const diff = actualTotal - calculatedSystemTotal;
    const diffDisplay = document.getElementById('diff-display');
    const logoutBtn = document.getElementById('btn-close-business');

    document.getElementById('end-total-display').innerText = `¥${actualTotal.toLocaleString()}`;

    if (diff === 0) {
        diffDisplay.innerText = '± ¥0';
        diffDisplay.style.color = '#2e7d32';
    } else if (diff > 0) {
        diffDisplay.innerText = `+ ¥${diff.toLocaleString()} (過剰)`;
        diffDisplay.style.color = '#1565c0';
    } else {
        diffDisplay.innerText = `- ¥${Math.abs(diff).toLocaleString()} (不足)`;
        diffDisplay.style.color = '#d32f2f';
    }

    // 過不足があっても業務終了はできるようにする（店長認証で突破可能。closeBusiness()側で判定）。
    // ボタンは「一度は現金を数えて入力した」ことの目印として有効化する。
    if (logoutBtn) logoutBtn.disabled = false;

    return diff;
}

// 過不足がある状態で店長認証を待っている間、その差額を一時的に覚えておく
let pendingCloseBusinessDiff = 0;

// 業務終了（ログアウト）ボタンを押した時
// ------------------------------------------
// 過不足が0円ならそのまま終了できる。0円でない場合（数円の数え間違い等）は、
// 「合うまで帰れない」「帳尻合わせのため嘘の枚数を入力する」といった事態を避けるため、
// 店長バーコードによる認証をはさんだ上で、過不足があっても終了できるようにする。
// （店長認証を必須にすることで、誰でも自由に過不足を握りつぶせるわけではなく、
// 　あくまで店長が承認した記録として終了させる）
function closeBusiness() {
    if (typeof playSound === 'function') playSound('click');

    const diff = calculateEndCash();

    if (diff === 0) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("過不足は0円です。本日の業務を終了しログアウトしますか？", "ほんじつ の ぎょうむ を しゅうりょう し ます か？", (res) => {
                if (!res) return;
                performCloseBusiness(0);
            }, true);
        }
        return;
    }

    // 過不足がある場合：店長認証（バーコードスキャン／入力）を要求する。
    // 認証成功後は openManagerAuthTarget() の 'close-business-with-diff' 分岐から
    // finalizeCloseBusinessWithDiscrepancy() が呼ばれる。
    pendingCloseBusinessDiff = diff;
    if (typeof requestManagerAuth === 'function') {
        if (typeof speak === 'function') speak("かふそく が あり ます。 てんちょう にんしょう を おこなっ て ください");
        requestManagerAuth('close-business-with-diff');
    } else {
        // 店長認証システムが読み込まれていない環境向けのフォールバック
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `過不足が ${diff > 0 ? '+' : '-'}¥${Math.abs(diff).toLocaleString()} あります。このまま終了しますか？`,
                "かふそく が あり ます。 しゅうりょう し ます か？",
                (res) => { if (res) performCloseBusiness(diff); },
                true
            );
        }
    }
}

// 店長認証の成功後に呼ばれる（過不足がある状態での終了）。
// auth-system.js の openManagerAuthTarget() から呼び出される。
function finalizeCloseBusinessWithDiscrepancy() {
    const diff = pendingCloseBusinessDiff;
    pendingCloseBusinessDiff = 0;

    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            `過不足 ${diff > 0 ? '+' : '-'}¥${Math.abs(diff).toLocaleString()} を店長承認のうえ、本日の業務を終了しログアウトします。よろしいですか？`,
            "てんちょう しょうにん の うえ しゅうりょう し ます",
            (res) => { if (res) performCloseBusiness(diff); },
            true
        );
    } else {
        performCloseBusiness(diff);
    }
}

// 実際の終了処理。過不足があった場合は、あとで確認できるよう金額を記録しておく（監査用）。
function performCloseBusiness(diff) {
    localStorage.setItem('pos_business_closed', 'true');

    if (diff !== 0) {
        const closedByName = (typeof activeClerkName !== 'undefined' && activeClerkName) ? activeClerkName : null;
        localStorage.setItem('pos_last_close_diff', JSON.stringify({
            diff: diff,
            closedAt: Date.now(),
            approvedBy: closedByName
        }));
    } else {
        localStorage.removeItem('pos_last_close_diff');
    }

    isBusinessClosed = true;
    checkBusinessStatus();

    // 他の端末へ「本日の業務を終了しました」を知らせる（他の端末も終了状態になる）
    broadcastBusinessStatus({
        status: 'closed',
        message: '本日の業務を終了しました',
        diff: diff,
        closedBy: (typeof activeClerkName !== 'undefined' && activeClerkName) ? activeClerkName : null
    });

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
    if (typeof speak === 'function') speak("ほんじつ の ぎょうむ は しゅうりょく し まし た。 レシート を ほぞん し まし た");
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

    // 他の端末からの「業務開始／終了」を受け取る
    const setupBusinessStatusSync = () => {
        if (typeof channel !== 'undefined' && channel) {
            channel.subscribe('business-status', (message) => {
                const d = message && message.data;
                if (!d) return;
                // 自分が送ったものは、すでに処理済みなので無視する
                if (d.senderId && typeof SYNC_DEVICE_ID !== 'undefined' && d.senderId === SYNC_DEVICE_ID) return;

                if (d.status === 'closed') {
                    localStorage.setItem('pos_business_closed', 'true');
                    if (typeof d.diff === 'number' && d.diff !== 0) {
                        localStorage.setItem('pos_last_close_diff', JSON.stringify({
                            diff: d.diff,
                            closedAt: d.time || Date.now(),
                            approvedBy: d.closedBy || null
                        }));
                    } else if (d.diff === 0) {
                        localStorage.removeItem('pos_last_close_diff');
                    }
                    isBusinessClosed = true;
                    checkBusinessStatus();
                } else if (d.status === 'open') {
                    if (d.startCash !== undefined && d.startCash !== null) {
                        localStorage.setItem('pos_start_cash', String(d.startCash));
                    }
                    localStorage.removeItem('pos_business_closed');
                    isBusinessClosed = false;
                    checkBusinessStatus();
                }
            });
        } else {
            setTimeout(setupBusinessStatusSync, 1000);
        }
    };
    setupBusinessStatusSync();

    window.addEventListener('storage', (e) => {
        if (e.key === 'pos_business_closed') {
            checkBusinessStatus();
        }
    });
});