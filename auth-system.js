// ==========================================
// ハイテク音声レジスター - 認証・タイムカード・データ移行・履歴用JavaScript
// ==========================================

// 現在履歴を見ている人（'manager' または 担当者名）
let currentHistoryViewer = null;

// ------------------------------------------
// 店長認証 & 共通分岐
// ------------------------------------------

// 店長認証済みかどうかの判定。
// 【注意】以前はここを「sessionStorage の pos_manager_auth フラグが 'true' かどうか」
// だけで判定している箇所が複数あった。これだと本物のバーコードを知らない人でも、
// ブラウザの検証（devtools）コンソールを開いて
//   sessionStorage.setItem('pos_manager_auth', 'true')
// と1行打ち込むだけで、店長権限が必要な画面（履歴削除・タイムカード削除など）を
// 突破できてしまっていた。
// これを防ぐため、ローカルのフラグに加えて「Firebase Authに“匿名ではなく”
// 実際にサインインしているか」も必ず一緒に確認する。firebase.auth().currentUser は
// 本物の店長バーコード（＝Firebaseのパスワード）で認証しない限り手に入らないため、
// devtoolsで変数やsessionStorageの値を書き換えるだけでは突破できない。
function isManagerAuthorized() {
    const hasLocalFlag = (typeof managerAuthDone !== 'undefined' && managerAuthDone) || sessionStorage.getItem('pos_manager_auth') === 'true';
    if (!hasLocalFlag) return false;

    // firebase-manager-auth.js が読み込まれていない等、Firebase未対応環境では
    // 従来通りローカルフラグのみで判定する（後方互換のためのフォールバック）
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') return hasLocalFlag;

    const user = firebase.auth().currentUser;
    return !!user && user.isAnonymous === false;
}

function updateManagerButtonState() {
    const lockBtn = document.getElementById('manager-lock-btn');
    if (!lockBtn) return;

    if (typeof managerAuthDone !== 'undefined' && managerAuthDone) {
        lockBtn.innerText = '店長ロック';
    } else {
        lockBtn.innerText = '店長認証';
    }
}

function handleManagerBtnClick() {
    if (typeof managerAuthDone !== 'undefined' && managerAuthDone) {
        lockManagerAuth();
    } else {
        requestManagerAuth('home');
    }
}

function requestManagerAuth(target = 'customer') {
    if (typeof managerAuthTarget !== 'undefined') {
        managerAuthTarget = target;
    }
    if (typeof playSound === 'function') playSound('click');

    if (typeof managerAuthDone !== 'undefined' && managerAuthDone) {
        const modal = document.getElementById('manager-auth-modal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
            if (modal) modal.style.display = 'none';
            openManagerAuthTarget(target);
        }, 100);
        return;
    }

    const input = document.getElementById('manager-auth-input');
    const err = document.getElementById('manager-auth-error');
    const modal = document.getElementById('manager-auth-modal');

    if (input) input.value = '';
    if (err) err.style.display = 'none';
    if (modal) modal.style.display = 'flex';
    if (input) input.focus();
    if (typeof speak === 'function') speak("てんちょう にんしょう");
}

function closeManagerAuth() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('manager-auth-modal');
    if (modal) modal.style.display = 'none';
}

function verifyManagerAuth() {
    const inputEl = document.getElementById('manager-auth-input');
    if (!inputEl) return;
    const val = inputEl.value.trim();

    const managerClerk = typeof clerks !== 'undefined' ? clerks.find(c => c.name === '店長') : null;
    const isMatch = (managerClerk && managerClerk.barcode && managerClerk.barcode === val) || 
                    (typeof clerks !== 'undefined' && clerks.some(c => c.barcode === val && (c.name === '店長' || c.name.includes('店長'))));

    if (isMatch && val !== "") {
        if (typeof playSound === 'function') playSound('success');
        closeManagerAuth();
        if (typeof managerAuthDone !== 'undefined') managerAuthDone = true;
        sessionStorage.setItem('pos_manager_auth', 'true');
        sessionStorage.setItem('pos_manager_auth_time', Date.now().toString());
        
        updateManagerButtonState();
        const apiSettings = document.getElementById('api-settings-container');
        if (apiSettings) apiSettings.style.display = 'block';

        openManagerAuthTarget(typeof managerAuthTarget !== 'undefined' ? managerAuthTarget : 'home');
        if (typeof speak === 'function') speak("てんちょう にんしょう せいこう し まし た");
    } else {
        if (typeof playSound === 'function') playSound('error');
        const err = document.getElementById('manager-auth-error');
        if (err) err.style.display = 'block';
        if (typeof speak === 'function') speak("にんしょう しっぱい し まし た");
        inputEl.focus();
    }
}

function lockManagerAuth() {
    if (typeof playSound === 'function') playSound('click');
    if (typeof managerAuthDone !== 'undefined') managerAuthDone = false;
    sessionStorage.removeItem('pos_manager_auth');
    sessionStorage.removeItem('pos_manager_auth_time');

    updateManagerButtonState();
    const apiSettings = document.getElementById('api-settings-container');
    if (apiSettings) apiSettings.style.display = 'none';

    if (typeof goHome === 'function') {
        goHome();
    }
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak("てんちょう ロック を かけ まし た");
}

// ------------------------------------------
// 店長ロックの自動タイムアウト（10分間操作がなくても、認証状態を保持していないよう
// 一定時間で自動的にロックし直す）
// ------------------------------------------
const MANAGER_AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10分

function checkManagerAuthExpiry() {
    if (typeof managerAuthDone === 'undefined' || !managerAuthDone) return;
    const grantedAt = parseInt(sessionStorage.getItem('pos_manager_auth_time') || '0', 10);
    if (!grantedAt || (Date.now() - grantedAt) > MANAGER_AUTH_TIMEOUT_MS) {
        managerAuthDone = false;
        sessionStorage.removeItem('pos_manager_auth');
        sessionStorage.removeItem('pos_manager_auth_time');
        updateManagerButtonState();
        const apiSettings = document.getElementById('api-settings-container');
        if (apiSettings) apiSettings.style.display = 'none';
        if (typeof speak === 'function') speak("じかん が たった ため、 てんちょう ロック が じどう で かかり まし た");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkManagerAuthExpiry(); // リロード直後、すでに期限切れの場合は即座にロックする
    setInterval(checkManagerAuthExpiry, 30 * 1000);
});

function openManagerAuthTarget(target) {
    if (typeof showScreen === 'function') {
        if (target === 'product') {
            showScreen('product-screen');
        } else if (target === 'migration') {
            showScreen('migration-screen');
        } else if (target === 'customer') {
            showScreen('customer-mgmt-screen');
        } else if (target === 'history') {
            showScreen('history-screen');
            renderHistory();
        } else if (target === 'discount') {
            showScreen('discount-screen');
            if (typeof renderDiscounts === 'function') renderDiscounts();
        } else if (target === 'refund-delete') {
            // 返金時のお会計履歴削除：店長認証成功後にそのまま削除を実行する
            // （画面遷移は行わない。返金モーダルはそのまま維持する）
            if (typeof finalizeRefundDeletion === 'function') finalizeRefundDeletion();
        } else {
            showScreen('home-screen');
        }
    }
}

// ------------------------------------------
// 履歴閲覧の認証モーダル
// ------------------------------------------
function requestHistoryAuth() {
    if (typeof playSound === 'function') playSound('click');
    const input = document.getElementById('history-auth-input');
    if (input) {
        input.value = '';
        input.removeEventListener('keydown', historyAuthKeydownHandler);
        input.addEventListener('keydown', historyAuthKeydownHandler);
    }
    const errorMsg = document.getElementById('history-auth-error');
    if (errorMsg) errorMsg.style.display = 'none';
    
    const modal = document.getElementById('history-auth-modal');
    if (modal) modal.style.display = 'flex';
    
    if (input) input.focus();
    if (typeof speak === 'function') speak("ばーこーど を にゅうりょく し て ください");
}

function historyAuthKeydownHandler(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        verifyHistoryAuth();
    }
}

function closeHistoryAuth() {
    if (typeof playSound === 'function') playSound('click');
    const modal = document.getElementById('history-auth-modal');
    if (modal) modal.style.display = 'none';
}

function verifyHistoryAuth() {
    const inputEl = document.getElementById('history-auth-input');
    if (!inputEl) return;
    const val = inputEl.value.trim();
    
    if (!val) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    const matchedClerk = typeof clerks !== 'undefined' ? clerks.find(c => c.barcode === val) : null;

    if (matchedClerk) {
        if (typeof playSound === 'function') playSound('success');
        closeHistoryAuth();

        if (matchedClerk.name === '店長' || matchedClerk.name.includes('店長')) {
            currentHistoryViewer = 'manager';
        } else {
            currentHistoryViewer = matchedClerk.name;
        }

        sessionStorage.setItem('pos_history_auth', 'true');

        if (typeof showScreen === 'function') showScreen('history-screen');
        renderHistory();
        if (typeof speak === 'function') speak("りれき を ひょうじ し ます");
    } else {
        if (typeof playSound === 'function') playSound('error');
        const errorMsg = document.getElementById('history-auth-error');
        if (errorMsg) errorMsg.style.display = 'block';
        if (typeof speak === 'function') speak("にんしょう しっぱい");
        inputEl.focus();
    }
}

// ------------------------------------------
// タイムカード機能
// ------------------------------------------
function openTimecardScreen() {
    if (typeof playSound === 'function') playSound('click');
    if (typeof showScreen === 'function') showScreen('timecard-screen');
    renderTimecardTable();
    const input = document.getElementById('tc-barcode-input');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (typeof speak === 'function') speak("たいむかーど かんり");
}

function getTimecardData() {
    return JSON.parse(localStorage.getItem('pos_timecard')) || [];
}

function saveTimecardData(data) {
    localStorage.setItem('pos_timecard', JSON.stringify(data));
}

function handleTimecardStamp(type = null) {
    const input = document.getElementById('tc-barcode-input');
    if (!input) return;
    const barcode = input.value.trim();
    const msgEl = document.getElementById('tc-status-msg');

    if (!barcode) {
        if (typeof playSound === 'function') playSound('error');
        if (msgEl) {
            msgEl.style.color = 'red';
            msgEl.innerText = "バーコードを入力してください。";
        }
        return;
    }

    const matchedClerk = typeof clerks !== 'undefined' ? clerks.find(c => c.barcode === barcode) : null;
    if (!matchedClerk) {
        if (typeof playSound === 'function') playSound('error');
        if (msgEl) {
            msgEl.style.color = 'red';
            msgEl.innerText = "該当する担当者が見つかりません。";
        }
        if (typeof speak === 'function') speak("たんとうしゃ が みつかり ませ ん");
        return;
    }

    const now = new Date();
    const todayStr = now.toLocaleDateString('ja-JP');
    const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

    let records = getTimecardData();
    let record = records.find(r => r.date === todayStr && r.clerkName === matchedClerk.name);

    if (!record) {
        record = {
            id: Date.now(),
            date: todayStr,
            clerkName: matchedClerk.name,
            clockIn: null,
            breakStart: null,
            breakEnd: null,
            clockOut: null
        };
        records.unshift(record);
    }

    if (!type) {
        if (!record.clockIn) type = 'clockIn';
        else if (record.clockIn && !record.breakStart && !record.clockOut) type = 'breakStart';
        else if (record.breakStart && !record.breakEnd) type = 'breakEnd';
        else type = 'clockOut';
    }

    let actionLabel = "";
    if (type === 'clockIn') {
        record.clockIn = timeStr;
        actionLabel = "出勤";
    } else if (type === 'breakStart') {
        record.breakStart = timeStr;
        actionLabel = "休憩開始";
    } else if (type === 'breakEnd') {
        record.breakEnd = timeStr;
        actionLabel = "休憩終了";
    } else if (type === 'clockOut') {
        record.clockOut = timeStr;
        actionLabel = "退勤";
    }

    saveTimecardData(records);
    if (typeof playSound === 'function') playSound('success');

    if (msgEl) {
        msgEl.style.color = 'green';
        msgEl.innerText = `${matchedClerk.name} 様: ${actionLabel} (${timeStr}) を記録しました。`;
    }

    const speakName = matchedClerk.kana ? matchedClerk.kana : matchedClerk.name;
    if (typeof speak === 'function') speak(`${speakName} さん ${actionLabel} を きろく し まし た`);
    
    input.value = '';
    input.focus();
    renderTimecardTable();
}

function calculateWorkDuration(rec) {
    if (!rec.clockIn || !rec.clockOut) return '-';
    try {
        const parseTime = (timeStr) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };
        let start = parseTime(rec.clockIn);
        let end = parseTime(rec.clockOut);
        if (end < start) end += 24 * 60;

        let breakDiff = 0;
        if (rec.breakStart && rec.breakEnd) {
            let bStart = parseTime(rec.breakStart);
            let bEnd = parseTime(rec.breakEnd);
            if (bEnd < bStart) bEnd += 24 * 60;
            breakDiff = bEnd - bStart;
        }

        let totalMinutes = (end - start) - breakDiff;
        if (totalMinutes < 0) totalMinutes = 0;

        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return `${hours}時間${mins}分`;
    } catch (e) {
        return '-';
    }
}

function renderTimecardTable() {
    const tbody = document.getElementById('timecard-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const records = getTimecardData();
    const isManager = isManagerAuthorized();

    const clearBtn = document.getElementById('timecard-clear-btn');
    if (clearBtn) clearBtn.style.display = isManager ? 'inline-block' : 'none';

    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">タイムカードの記録がありません</td></tr>';
        return;
    }

    records.forEach((rec) => {
        const tr = document.createElement('tr');
        const duration = calculateWorkDuration(rec);
        tr.innerHTML = `
            <td>${rec.date}</td>
            <td><b>${rec.clerkName}</b></td>
            <td>${rec.clockIn || '-'}</td>
            <td>${rec.breakStart || '-'}</td>
            <td>${rec.breakEnd || '-'}</td>
            <td>${rec.clockOut || '-'}</td>
            <td style="font-weight:bold; color:#0066cc;">${duration}</td>
        `;
        tbody.appendChild(tr);
    });
}

function clearAllTimecards() {
    if (!isManagerAuthorized()) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("全タイムカードの削除は店長のみ可能です。", "てんちょう のみ かのう です。", () => {}, true);
        } else {
            alert("全タイムカードの削除は店長のみ可能です。");
        }
        return;
    }

    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("すべてのタイムカード記録を完全に削除しますか？", "すべての きろく を さくじょ し ます か？", (res) => {
            if (!res) return;
            localStorage.removeItem('pos_timecard');
            if (typeof playSound === 'function') playSound('click');
            renderTimecardTable();
            if (typeof speak === 'function') speak("すべての きろく を さくじょ し まし た");
        }, true);
    }
}

function exportTimecardXlsx() {
    try {
        if (typeof playSound === 'function') playSound('click');
        const records = getTimecardData();
        if (records.length === 0) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("出力するタイムカードデータがありません。", "しゅつりょく する データ が あり ませ ん。", () => {}, true);
            }
            return;
        }

        const excelData = [
            ["日付", "担当者名", "出勤時間", "休憩開始", "休憩終了", "退勤時間", "実働時間"]
        ];

        records.forEach(rec => {
            excelData.push([
                rec.date,
                rec.clerkName,
                rec.clockIn || '-',
                rec.breakStart || '-',
                rec.breakEnd || '-',
                rec.clockOut || '-',
                calculateWorkDuration(rec)
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(excelData);
        worksheet['!cols'] = [
            { wch: 15 },
            { wch: 15 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 15 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "タイムカード");

        const fileName = `タイムカード_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak("たいむかーど を しゅつりょく し まし た");
    } catch (err) {
        console.error(err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("タイムカードの出力に失敗しました。", "しゅつりょく に しっぱい し まし た。", () => {}, true);
        }
    }
}

// ------------------------------------------
// 機種移行・データ管理・ロゴ設定関連
// ------------------------------------------
function confirmResetAllData() {
    if (typeof resetStep !== 'undefined') resetStep = 1;
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            "【注意 1/2】商品データと履歴を初期化します（会員・店員データは保護されます）。本当によろしいですか？",
            "【ちゅうい いち の ニ】しょうひん と りれき を 初期化 し ます。",
            handleResetStep,
            true
        );
    }
}

function handleResetStep(res) {
    if (!res) { if (typeof resetStep !== 'undefined') resetStep = 0; return; }
    if (typeof resetStep !== 'undefined' && resetStep === 1) {
        resetStep = 2;
        setTimeout(() => {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    "【最終確認 2/2】商品と履歴のデータが削除されます。最終確認です。",
                    "【さいしゅう かくにん に の ニ】しょうひん と りれき の データ が さくじょ さ れ ます。",
                    handleResetStep,
                    true
                );
            }
        }, 100);
    } else if (typeof resetStep !== 'undefined' && resetStep === 2) {
        resetStep = 0;
        if (typeof products !== 'undefined') products = [];
        localStorage.removeItem('pos_products');
        localStorage.removeItem('pos_history');
        
        if (typeof playSound === 'function') playSound('success');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("商品と履歴データを初期化しました。（会員データと店員データは保持されています）", "しょうひん と りれき データ を 初期化 し まし た。", () => {
                if (typeof goHome === 'function') goHome();
            }, false);
        }
    }
}

// 現在の全データをひとつのオブジェクトにまとめる。
// local-backup.js（JSONファイルへの手動保存・自動保存の両方）から共通で使う。
function buildAllDataObject() {
    return {
        clerks: typeof clerks !== 'undefined' ? clerks : [],
        products: typeof products !== 'undefined' ? products : [],
        customers: typeof customers !== 'undefined' ? customers : [], 
        activeClerkName: typeof activeClerkName !== 'undefined' ? activeClerkName : '店員',
        history: JSON.parse(localStorage.getItem('pos_history')) || [],
        timecards: getTimecardData(),
        apiKey: localStorage.getItem('pos_api_key') || '',
        shopLogo: localStorage.getItem('pos_shop_logo') || '',
        // 追加：自動化バーコード（クーポン）・商品の種類・お会計完了画像も機種変更時に一緒に移行できるようにする
        discounts: JSON.parse(localStorage.getItem('pos_discounts') || '[]'),
        customGenres: JSON.parse(localStorage.getItem('pos_custom_genres') || '[]'),
        checkoutCompleteImage: localStorage.getItem('pos_checkout_complete_image') || '',
        // 追加：本日の釣銭準備金・営業終了状態も機種変更/復元時に一緒に戻せるようにする
        startCash: localStorage.getItem('pos_start_cash') || '',
        businessClosed: localStorage.getItem('pos_business_closed') || '',
        savedAt: new Date().toISOString()
    };
}

// ------------------------------------------
// 【送る／受け取る】のクリップボード貼り付け方式は廃止しました。
// 現在は local-backup.js のJSONファイル書き出し・読み込み
// （downloadDataBackupFile / restoreDataFromBackupFileInput）に統一しています。
// buildAllDataObject() と applyImportedDataObject() は、その仕組みから
// 引き続き利用される共通処理として残しています。
// ------------------------------------------

// データオブジェクトを実際にlocalStorage・変数へ反映する共通処理。
// 「バックアップファイルから復元する」機能から呼び出される。
// options.reload : 反映後にページをリロードするか（既定: true）
// options.silent : 完了メッセージを表示しないか（既定: false）
function applyImportedDataObject(dataObj, options) {
    options = options || {};
    if (dataObj.clerks && typeof clerks !== 'undefined') clerks = dataObj.clerks;
    if (dataObj.products && typeof products !== 'undefined') products = dataObj.products;
    if (dataObj.customers && typeof customers !== 'undefined') customers = dataObj.customers;
    if (dataObj.activeClerkName && typeof activeClerkName !== 'undefined') activeClerkName = dataObj.activeClerkName;
    if (dataObj.history) localStorage.setItem('pos_history', JSON.stringify(dataObj.history));
    if (dataObj.timecards) saveTimecardData(dataObj.timecards);

    if (dataObj.apiKey !== undefined) {
        localStorage.setItem('pos_api_key', dataObj.apiKey);
    }
    if (dataObj.shopLogo !== undefined) {
        localStorage.setItem('pos_shop_logo', dataObj.shopLogo);
    }
    if (Array.isArray(dataObj.discounts)) {
        localStorage.setItem('pos_discounts', JSON.stringify(dataObj.discounts));
    }
    if (Array.isArray(dataObj.customGenres)) {
        localStorage.setItem('pos_custom_genres', JSON.stringify(dataObj.customGenres));
    }
    if (dataObj.checkoutCompleteImage) {
        localStorage.setItem('pos_checkout_complete_image', dataObj.checkoutCompleteImage);
    }
    if (dataObj.startCash !== undefined && dataObj.startCash !== '') {
        localStorage.setItem('pos_start_cash', dataObj.startCash);
    }
    if (dataObj.businessClosed !== undefined) {
        if (dataObj.businessClosed) {
            localStorage.setItem('pos_business_closed', dataObj.businessClosed);
        } else {
            localStorage.removeItem('pos_business_closed');
        }
    }

    if (typeof clerks !== 'undefined') localStorage.setItem('pos_clerks', JSON.stringify(clerks));
    if (typeof products !== 'undefined') localStorage.setItem('pos_products', JSON.stringify(products));
    if (typeof customers !== 'undefined') localStorage.setItem('pos_customers', JSON.stringify(customers));
    if (typeof activeClerkName !== 'undefined') localStorage.setItem('pos_active_clerk', activeClerkName);

    if (options.silent) {
        if (options.reload !== false) location.reload();
        return;
    }

    if (typeof playSound === 'function') playSound('success');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("データの取り込みが完了しました！", "でーた の とりこみ が かんりょう し まし た！", () => {
            if (options.reload !== false) location.reload();
        }, false);
    } else if (options.reload !== false) {
        location.reload();
    }
}

function uploadShopLogo(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Image = e.target.result;
        localStorage.setItem('pos_shop_logo', base64Image);
        applyShopLogo();
        if (typeof playSound === 'function') playSound('success');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("お店のロゴ画像を保存しました！", "ろご がぞう を ほぞん し まし た", () => {}, false);
        }
    };
    reader.readAsDataURL(file);
}

function clearShopLogo() {
    localStorage.removeItem('pos_shop_logo');
    applyShopLogo();
    if (typeof playSound === 'function') playSound('click');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("ロゴ画像を初期化しました。", "ろご がぞう を しょきか し まし た", () => {}, false);
    }
}

function applyShopLogo() {
    const logoData = localStorage.getItem('pos_shop_logo');
    const defaultLogo = "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Yaoko_logo.svg/512px-Yaoko_logo.svg.png";
    const logoSrc = logoData ? logoData : defaultLogo;

    const homeLogo = document.getElementById('home-shop-logo');
    if (homeLogo) homeLogo.src = logoSrc;

    const receiptLogo = document.getElementById('receipt-preview-logo');
    if (receiptLogo) receiptLogo.src = logoSrc;
}

// ------------------------------------------
// 履歴管理（閲覧制限・権限フィルター・エクセル出力）
// ------------------------------------------
function renderHistory() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
    
    if (currentHistoryViewer && currentHistoryViewer !== 'manager') {
        historyList = historyList.filter(rec => rec.clerk === currentHistoryViewer);
    }

    const exportBtn = document.querySelector('.csv-export-btn');
    const historyBtnContainer = document.querySelector('.history-btn-container');
    const isManager = (currentHistoryViewer === 'manager') || isManagerAuthorized();

    if (exportBtn) exportBtn.style.display = isManager ? 'inline-block' : 'none';
    if (historyBtnContainer) historyBtnContainer.style.display = isManager ? 'flex' : 'none';

    if (historyList.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">表示できる履歴がありません</td></tr>'; 
        return; 
    }

    historyList.forEach(rec => {
        const tr = document.createElement('tr');
        let changeInfo = rec.change !== undefined ? ` (預:¥${rec.deposit.toLocaleString()} / 釣:¥${rec.change.toLocaleString()})` : '';
        tr.innerHTML = `<td style="text-align:center;"><input type="checkbox" class="hist-check" value="${rec.id}"></td><td>${rec.date}</td><td>${rec.clerk}</td><td style="font-weight:bold; color:#d35400;">¥${rec.total.toLocaleString()}${changeInfo}</td><td>${rec.payment}</td><td style="font-size:12px;">${rec.items}</td>`;
        tbody.appendChild(tr);
    });
}

function deleteSelectedHistory() {
    if (currentHistoryViewer !== 'manager' && !isManagerAuthorized()) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("履歴の削除は店長のみ可能です。", "りれき の さくじょ は てんちょう のみ かのう です。", () => {}, true);
        } else {
            alert("履歴の削除は店長のみ可能です。");
        }
        return;
    }

    const checks = document.querySelectorAll('.hist-check:checked');
    if (checks.length === 0) { 
        if (typeof playSound === 'function') playSound('error'); 
        return; 
    }
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("選択した履歴を削除しますか？", "せんたく し た りれき を さくじょ し ます か？", (res) => {
            if (!res) return;
            let historyList = JSON.parse(localStorage.getItem('pos_history')) || [];
            const ids = Array.from(checks).map(cb => parseInt(cb.value));
            historyList = historyList.filter(rec => !ids.includes(rec.id));
            localStorage.setItem('pos_history', JSON.stringify(historyList));
            if (typeof playSound === 'function') playSound('click'); 
            renderHistory();
            if (typeof speak === 'function') speak("りれき を さくじょ し まし た");
        }, true);
    }
}

function clearAllHistory() {
    if (currentHistoryViewer !== 'manager' && !isManagerAuthorized()) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("すべての履歴の削除は店長のみ可能です。", "すべての りれき の さくじょ は てんちょう のみ かのう です。", () => {}, true);
        } else {
            alert("すべての履歴の削除は店長のみ可能です。");
        }
        return;
    }

    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("すべての履歴を本当に削除しますか？", "すべての りれき を ほんとう に さくじょ し ます か？", (res) => {
            if (!res) return;
            localStorage.removeItem('pos_history');
            if (typeof playSound === 'function') playSound('click'); 
            renderHistory();
            if (typeof speak === 'function') speak("すべての りれき を さくじょ し まし た");
        }, true);
    }
}

// ==========================================
// お会計履歴のエクセル(.xlsx)出力機能（店長限定）
// ==========================================
function exportHistorycsv() {
    try {
        if (typeof playSound === 'function') playSound('click');
        
        // currentHistoryViewer === 'manager' の判定を追加修正
        const isManager = (currentHistoryViewer === 'manager') || isManagerAuthorized();

        if (!isManager) {
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("エクセル(.xlsx)の保存は店長のみ可能です。", "えくせる の ほぞん は てんちょう のみ かのう です。", () => {}, true);
            } else {
                alert("エクセル(.xlsx)の保存は店長のみ可能です。");
            }
            return;
        }
        
        const historyData = JSON.parse(localStorage.getItem('pos_history')) || [];
        if (historyData.length === 0) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("出力する履歴がありません。", "しゅつりょく する りれき が あり ませ ん。", () => {}, true);
            } else {
                alert("出力する履歴がありません。");
            }
            return;
        }

        const excelData = [];
        excelData.push(["日時", "担当者", "合計金額", "支払方法", "購入内容"]);

        historyData.forEach(item => {
            const date = item.date || '-';
            const clerk = item.clerk || '-';
            const total = item.total !== undefined ? Number(item.total) : 0;
            const payMethod = item.payment || item.payMethod || '-';
            
            let itemsText = '-';
            const rawItems = item.items || item.cart || item.product || item.goods || item.details;
            
            if (rawItems) {
                let parsedItems = rawItems;
                if (typeof rawItems === 'string') {
                    try {
                        parsedItems = JSON.parse(rawItems);
                    } catch (e) {
                        itemsText = rawItems.replace(/<[^>]*>/g, '').trim();
                    }
                }

                if (Array.isArray(parsedItems)) {
                    itemsText = parsedItems.map(i => {
                        if (typeof i === 'object' && i !== null) {
                            const name = i.name || i.title || i.productName || '商品';
                            const price = i.price !== undefined ? i.price : 0;
                            const qty = i.quantity !== undefined ? i.quantity : (i.qty || 1);
                            return `${name} (${price}円×${qty})`;
                        } else {
                            return String(i);
                        }
                    }).join(' / ');
                } else if (typeof parsedItems === 'object' && parsedItems !== null && itemsText === '-') {
                    const name = parsedItems.name || parsedItems.title || '商品';
                    const price = parsedItems.price || 0;
                    const qty = parsedItems.quantity || parsedItems.qty || 1;
                    itemsText = `${name} (${price}円×${qty})`;
                }
            }

            excelData.push([date, clerk, total, payMethod, itemsText]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(excelData);
        worksheet['!cols'] = [
            { wch: 20 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 50 }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "お会計履歴");

        const fileName = `お会計履歴_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak("りれき を しゅつりょく し まし た");

    } catch (err) {
        console.error(err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("履歴の出力に失敗しました。", "りれき の しゅつりょく に しっぱい し まし た。", () => {}, true);
        }
    }
}

// ------------------------------------------
// 起動時の初期化処理
// ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    applyShopLogo();

    if (sessionStorage.getItem('pos_manager_auth') === 'true') {
        if (typeof managerAuthDone !== 'undefined') managerAuthDone = true;
    }
    updateManagerButtonState();

    const janInput = document.getElementById('jan-input');
    if (janInput) {
        let isNavigatingToCheckout = false; 

        janInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation(); 
                if (janInput.value.trim() === '') {
                    e.preventDefault();
                    if (isNavigatingToCheckout) return;
                    isNavigatingToCheckout = true;

                    if (typeof openCheckout === 'function') {
                        openCheckout();
                    }

                    setTimeout(() => {
                        isNavigatingToCheckout = false;
                    }, 500);
                } else {
                    e.preventDefault();
                    if (typeof submitInput === 'function') {
                        submitInput();
                    }
                }
            }
        });
    }
});