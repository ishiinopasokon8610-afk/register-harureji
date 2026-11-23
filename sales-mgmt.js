// ==========================================
// ハイテク音声レジスター - 売上管理・精算機能
// ==========================================

// 【今回の修正】業務の開始・終了（チェックアウト）が、他の端末に伝わっていなかった。
// 原因：送受信に使っていた旧い同期の窓口は、外部同期サービスをやめた時点で存在しなくなっており、
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
    const startTotalEl0 = document.getElementById('start-total-display');
    if (startTotalEl0) startTotalEl0.innerText = '¥0';
    if (typeof speak === 'function') speak("つりせん じゅんびきん を にゅうりょく し て ください");
}

// 準備金入力をキャンセルした時
function closeStartBusiness() {
    const modal = document.getElementById('business-start-modal');
    if (modal) modal.style.display = 'none';
    checkBusinessStatus();
}

// 枚数の入力欄を数として読む（空・マイナス・小数は0〜整数にそろえる）
function cashCountOf(id) {
    const el = document.getElementById(id);
    const n = el ? parseInt(el.value, 10) : 0;
    return (n > 0) ? n : 0;
}

// 準備金（釣銭）の入力計算
// 各入力欄は「金額」ではなく「枚数」を入力する仕様。
// 金種（denomination）× 入力された枚数（count）＝ 金額 を自動計算する。
// 疲れたスタッフが「枚数のつもりで金額を打ってしまう／掛け算を間違える」ことによる
// 過不足（違算）を防ぐため、金種ごとの内訳（小計）も横に表示する。
function calculateStartCash() {
    let total = 0;
    const values = {
        10000: cashCountOf('start-10000'),
        5000: cashCountOf('start-5000'),
        1000: cashCountOf('start-1000'),
        500: cashCountOf('start-500'),
        100: cashCountOf('start-100'),
        50: cashCountOf('start-50'),
        10: cashCountOf('start-10'),
        5: cashCountOf('start-5'),
        1: cashCountOf('start-1')
    };

    for (const [denomination, count] of Object.entries(values)) {
        const subtotal = parseInt(denomination) * count;
        total += subtotal;
        const subEl = document.getElementById(`start-${denomination}-sub`);
        if (subEl) subEl.innerText = `¥${subtotal.toLocaleString()}`;
    }

    const startTotalEl = document.getElementById('start-total-display');
    if (startTotalEl) startTotalEl.innerText = `¥${total.toLocaleString()}`;
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
    const endTotalEl0 = document.getElementById('end-total-display');
    if (endTotalEl0) endTotalEl0.innerText = '¥0';
    const diffEl0 = document.getElementById('diff-display');
    if (diffEl0) { diffEl0.innerText = '¥0'; diffEl0.style.color = '#333'; }
    
    const logoutBtn = document.getElementById('btn-close-business');
    if (logoutBtn) logoutBtn.disabled = true;

    if (typeof speak === 'function') speak("うりあげ かんり 画面 です。 げんきん を 数え て 入力 し て ください");
}

// 取引の日時（dateISO があればそれを使う。無い古いデータは date の文字列から）
function salesRecordDate(item) {
    if (!item) return null;
    const t = item.dateISO ? new Date(item.dateISO) : (item.date ? new Date(item.date) : null);
    return (t && !isNaN(t.getTime())) ? t : null;
}

function calculateSystemTotals() {
    let historyData = [];
    try { historyData = JSON.parse(localStorage.getItem('pos_history') || '[]'); } catch (e) { historyData = []; }
    if (!Array.isArray(historyData)) historyData = [];
    const todayStr = new Date().toLocaleDateString('ja-JP');
    const startCash = parseInt(localStorage.getItem('pos_start_cash')) || 0;

    let cashSales = 0;
    cashlessTotal = 0;
    // 税区分ごとの売上（税込）。消費税申告用の参考値
    const taxSales = { 10: 0, 8: 0, 0: 0 };

    historyData.forEach(item => {
        const d = salesRecordDate(item);
        if (!d || d.toLocaleDateString('ja-JP') !== todayStr) return;
        const pay = item.payMethod || item.payment;
        const total = parseInt(item.total) || 0;
        if (pay === '現金') {
            cashSales += total;
        } else if (pay !== '全額ポイント') {
            cashlessTotal += total;
        }
        if (Array.isArray(item.cartSnapshot)) {
            item.cartSnapshot.forEach(ci => {
                if (!ci) return;
                const amount = (Number(ci.price) || 0) * (Number(ci.qty) || 0);
                const rate = (ci.taxRate === 8 || ci.taxRate === 0) ? ci.taxRate : 10;
                taxSales[rate] += amount;
            });
        }
    });

    calculatedSystemTotal = startCash + cashSales;

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText('system-cash-display', `¥${calculatedSystemTotal.toLocaleString()}`);
    setText('system-cashless-display', `¥${cashlessTotal.toLocaleString()}`);
    // 【不具合修正】「本日の税区分内訳」は、これまでどこからも計算されず、いつも ¥0 のままだった
    setText('tax-report-10-display', `¥${taxSales[10].toLocaleString()}`);
    setText('tax-report-8-display', `¥${taxSales[8].toLocaleString()}`);
    setText('tax-report-free-display', `¥${taxSales[0].toLocaleString()}`);
}

// レジ内現金の実査カウント（精算時）。
// こちらも start 側と同様、入力欄は「枚数」。金種ごとの金額（小計）を横に表示して
// 入力ミスにすぐ気付けるようにする。
function calculateEndCash() {
    // 【不具合修正】画面を開いたあとに他の端末で会計があっても、システム計算額が古いまま
    // 過不足を出してしまっていた。数えるたびに最新の売上で計算し直す
    calculateSystemTotals();
    let actualTotal = 0;
    const values = {
        10000: cashCountOf('end-10000'),
        5000: cashCountOf('end-5000'),
        1000: cashCountOf('end-1000'),
        500: cashCountOf('end-500'),
        100: cashCountOf('end-100'),
        50: cashCountOf('end-50'),
        10: cashCountOf('end-10'),
        5: cashCountOf('end-5'),
        1: cashCountOf('end-1')
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
    if (!diffDisplay) return diff;

    const endTotalEl = document.getElementById('end-total-display');
    if (endTotalEl) endTotalEl.innerText = `¥${actualTotal.toLocaleString()}`;

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
let closingBusinessNow = false;
function performCloseBusiness(diff) {
    // 【不具合修正】確認ダイアログを素早く2回押すと、終了処理（PNG保存・他端末への通知）が2回走っていた
    if (closingBusinessNow) return;
    closingBusinessNow = true;
    setTimeout(() => { closingBusinessNow = false; }, 3000);
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
        // 【不具合修正】レシートPNGで、数字（入力した枚数・金額）が枠に隠れて切れていた。
        // 原因：html2canvas は入力欄(input)の文字を枠いっぱいに描くため上下が欠け、画面がスクロール式だと
        //       見えている範囲しか撮れない。撮影用の複製の上で、入力欄を普通の文字に置き換え、
        //       高さ・はみ出しの制限を外して、全体を高解像度で撮る。
        html2canvas(salesMgmtScreen, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            scrollX: 0,
            scrollY: 0,
            windowWidth: Math.max(salesMgmtScreen.scrollWidth, 720),
            windowHeight: salesMgmtScreen.scrollHeight,
            onclone: (doc) => {
                const c = doc.getElementById('sales-mgmt-screen');
                if (!c) return;
                // 撮影用の複製は、ダークモードを外して「通常モード（明るい画面）」の色にする。
                // 背景は白。文字の色は通常モードのまま（過不足の緑・赤などもそのまま）。
                const win = doc.defaultView;
                try {
                    [doc.documentElement, doc.body].forEach(n => {
                        if (!n) return;
                        Array.from(n.classList).forEach(cl => { if (/dark|night/i.test(cl)) n.classList.remove(cl); });
                        Array.from(n.attributes).forEach(at => { if (/theme|dark|night|color-scheme/i.test(at.name) || /dark|night/i.test(at.value)) { if (at.name !== 'class' && at.name !== 'style' && at.name !== 'id') n.removeAttribute(at.name); } });
                        if (n.style) { n.style.filter = 'none'; n.style.colorScheme = 'light'; }
                    });
                    // ダークモード専用に差し込まれた<style>（idに dark / night を含むもの）だけ外す。
                    doc.querySelectorAll('style[id]').forEach(st => { if (/dark|night/i.test(st.id)) st.remove(); });
                    // 色の変数（--で始まるもの）が直接書かれていたら外す
                    [doc.documentElement, doc.body].forEach(n => {
                        if (!n || !n.style) return;
                        Array.from(n.style).filter(k => k.startsWith('--')).forEach(k => n.style.removeProperty(k));
                    });
                } catch (e) { /* 無視 */ }
                // ダーク/ライトモード（dark-mode-system.js）が付けた色の上書きを、撮影用コピーの中だけ元に戻す
                try {
                    ['pos-night-mode', 'pos-light-mode', 'pos-nm-scanning'].forEach(k => doc.documentElement.classList.remove(k));
                    const nmst = doc.getElementById('night-mode-style'); if (nmst) nmst.remove();
                    doc.querySelectorAll('[data-nm-scanned]').forEach(el => {
                        ['background', 'background-color', 'background-image', 'border-color', 'color'].forEach(prop => {
                            const ov = el.getAttribute('data-nm-orig-' + prop);
                            if (ov === null) return;
                            if (ov === '') el.style.removeProperty(prop); else el.style.setProperty(prop, ov);
                        });
                        el.classList.remove('pos-nm-bg', 'pos-nm-text');
                    });
                } catch (e) { /* 無視 */ }
                const bgCss = '#ffffff';
                const parseL = (rgb) => { const m = String(rgb).match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(',').map(x => parseFloat(x)); return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255; };
                // 通常モードの色でも明るすぎて読めない文字（白など）だけ、濃い色にする
                const amountColor = '#111111';
                c.style.setProperty('background-color', bgCss, 'important');
                c.style.boxSizing = 'border-box';
                c.style.width = Math.max(salesMgmtScreen.scrollWidth, 720) + 'px';
                c.style.margin = '0';
                c.style.left = '0';
                c.style.display = 'block';
                c.style.height = 'auto';
                c.style.maxHeight = 'none';
                c.style.overflow = 'visible';
                c.style.position = 'relative';
                c.style.padding = '16px';
                c.querySelectorAll('*').forEach(el => {
                    el.style.overflow = 'visible';
                    el.style.textOverflow = 'clip';
                    try { if (parseL(win.getComputedStyle(el).color) > 0.85) el.style.setProperty('color', '#111111', 'important'); } catch (e) { /* 無視 */ }
                    if (el.style.maxHeight) el.style.maxHeight = 'none';
                });
                // 入力欄は写さない（金額は、すでにある「¥0」などの小計を大きく表示する）
                c.querySelectorAll('input').forEach(inp => { inp.style.display = 'none'; });
                c.querySelectorAll('.cash-row-subtotal').forEach(el => {
                    el.style.fontSize = '24px';
                    el.style.fontWeight = '800';
                    el.style.setProperty('color', amountColor, 'important');
                    el.style.minWidth = '130px';
                    el.style.textAlign = 'right';
                    el.style.display = 'inline-block';
                    el.style.marginLeft = 'auto';
                });
                c.querySelectorAll('.cash-count-grid').forEach(g => { g.style.display = 'block'; });
                c.querySelectorAll('.cash-count-row').forEach(row => {
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.justifyContent = 'space-between';
                    row.style.padding = '4px 0';
                    row.style.borderBottom = '1px dashed #ddd';
                    const lb = row.querySelector('label');
                    if (lb) { lb.style.fontSize = '20px'; lb.style.fontWeight = '700'; lb.style.whiteSpace = 'nowrap'; lb.style.width = 'auto'; }
                });
                // レシートに不要な操作ボタンは写さない
                c.querySelectorAll('button, .back-btn').forEach(b => { b.style.display = 'none'; });
                // 大きい数字の見出しが上下で切れないように、行の高さに余裕を持たせる
                c.querySelectorAll('[id$="-display"], .cash-row-subtotal').forEach(el => {
                    el.style.lineHeight = '1.5';
                    el.style.paddingTop = '2px';
                    el.style.paddingBottom = '2px';
                    el.style.height = 'auto';
                });
            }
        }).then(canvas => {
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
/* ==========================================
   スマホ表示（縦長・幅の狭い画面）での売上管理・精算画面／準備金入力画面
   ------------------------------------------
   index.html・style.css は変更せず、ここからスタイルを足す。
   ========================================== */
(function injectSalesMgmtMobileStyle() {
    if (document.getElementById('sales-mgmt-mobile-style')) return;
    const st = document.createElement('style');
    st.id = 'sales-mgmt-mobile-style';
    st.textContent = `
@media (max-width: 820px) {
  #sales-mgmt-screen { padding-left: 10px !important; padding-right: 10px !important; box-sizing: border-box; overflow-x: hidden; }
  #sales-mgmt-screen > div { gap: 12px !important; }
  #sales-mgmt-screen > div > div { min-width: 0 !important; flex: 1 1 100% !important; box-sizing: border-box; padding: 14px !important; }
  #sales-mgmt-screen .top-bar-title { font-size: 17px; }
  #system-cash-display { font-size: 28px !important; word-break: break-all; }
  #system-cashless-display { font-size: 22px !important; word-break: break-all; }
  #sales-mgmt-screen .cash-count-grid { display: grid !important; grid-template-columns: 1fr !important; gap: 6px !important; }
  #sales-mgmt-screen .cash-count-row { display: grid !important; grid-template-columns: 74px minmax(0, 1fr) 84px; align-items: center; gap: 8px; margin: 0 !important; }
  #sales-mgmt-screen .cash-count-row label { font-size: 15px; white-space: nowrap; }
  #sales-mgmt-screen .cash-count-row input { width: 100% !important; min-width: 0; box-sizing: border-box; font-size: 18px; padding: 9px 8px; }
  #sales-mgmt-screen .cash-row-subtotal { text-align: right; font-size: 15px; white-space: nowrap; }
  #end-total-display { font-size: 22px !important; }
  #diff-display { word-break: break-all; }
  #btn-close-business { padding: 16px 10px !important; font-size: 17px !important; }
  #sales-mgmt-screen div[style*="min-width:150px"] { min-width: 0 !important; flex: 1 1 100% !important; }
}
`;
    document.head.appendChild(st);
})();

/* ==========================================
   「業務再開（準備金の入力）」画面：パソコン・スマホ（横向き含む）のどちらでも
   スクロールせずに1画面に収める。
   ・高さに余裕がある時：金種を3列×3行
   ・高さが低い時（スマホ横向きなど）：5列×2行に詰めて、説明文は隠す
   ========================================== */
(function injectBusinessStartModalStyle() {
    if (document.getElementById('business-start-modal-style')) return;
    const st = document.createElement('style');
    st.id = 'business-start-modal-style';
    st.textContent = `
#business-start-modal .modal-box {
  width: min(94vw, 560px) !important; max-width: min(94vw, 560px) !important;
  max-height: 98vh; max-height: 98dvh; overflow: visible !important; box-sizing: border-box;
  padding: 16px 18px !important; display: flex; flex-direction: column;
}
#business-start-modal .modal-title { margin: 0 0 6px 0 !important; font-size: 20px; }
#business-start-modal .modal-desc { margin: 0 0 10px 0 !important; font-size: 13px; line-height: 1.5; }
#business-start-modal .cash-count-grid {
  display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 8px !important; margin: 0 !important;
}
#business-start-modal .cash-count-row {
  display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 4px !important;
  margin: 0 !important; padding: 8px 8px 6px !important; background: #fafafa; border: 1px solid #e3e3e3; border-radius: 8px; box-sizing: border-box;
}
#business-start-modal .cash-count-row label { font-size: 15px !important; font-weight: 700; text-align: center; margin: 0 !important; width: auto !important; }
#business-start-modal .cash-count-row input {
  width: 100% !important; min-width: 0 !important; box-sizing: border-box; height: 40px; font-size: 20px !important; text-align: center;
  padding: 2px 4px !important; margin: 0 !important; -moz-appearance: textfield;
}
#business-start-modal .cash-count-row input::-webkit-outer-spin-button,
#business-start-modal .cash-count-row input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
#business-start-modal .cash-row-subtotal { text-align: center !important; font-size: 16px !important; font-weight: 700; color: #555; min-width: 0 !important; width: auto !important; }
#business-start-modal .modal-box > div[style*="text-align:right"] { margin: 10px 0 !important; font-size: 22px !important; }
#business-start-modal .modal-btn-group { display: flex; gap: 10px; margin: 0 !important; }
#business-start-modal .modal-btn-group .modal-btn { flex: 1; min-height: 46px; }
@media (max-height: 560px) {
  #business-start-modal .modal-box { width: min(97vw, 900px) !important; max-width: min(97vw, 900px) !important; padding: 8px 12px !important; }
  #business-start-modal .modal-title { font-size: 16px; margin-bottom: 4px !important; }
  #business-start-modal .modal-desc { display: none; }
  #business-start-modal .cash-count-grid { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 5px !important; }
  #business-start-modal .cash-count-row { padding: 4px 5px !important; gap: 2px !important; }
  #business-start-modal .cash-count-row label { font-size: 12px !important; }
  #business-start-modal .cash-count-row input { height: 30px; font-size: 16px !important; }
  #business-start-modal .cash-row-subtotal { font-size: 13px !important; }
  #business-start-modal .modal-box > div[style*="text-align:right"] { margin: 6px 0 !important; font-size: 18px !important; }
  #business-start-modal .modal-btn-group .modal-btn { min-height: 38px; font-size: 15px; padding: 4px 10px; }
}
`;
    document.head.appendChild(st);
})();
