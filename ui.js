function showScreen(screenId) {
    playSound('click');
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    const quickVoices = document.getElementById('clerk-quick-voices');
    if (['register-screen', 'clerk-screen', 'product-screen', 'history-screen', 'migration-screen', 'customer-mgmt-screen'].includes(screenId)) {
        quickVoices.style.display = 'flex';
    } else { quickVoices.style.display = 'none'; }

    if(screenId === 'clerk-screen') renderClerks();
    if(screenId === 'product-screen') { renderProducts(); if (typeof populateGenreSelects === 'function') populateGenreSelects(); if (typeof renderCustomGenreList === 'function') renderCustomGenreList(); }
    if(screenId === 'history-screen') renderHistory();
    if(screenId === 'customer-mgmt-screen') renderCustomers();
    if(screenId === 'discount-screen' && typeof renderDiscounts === 'function') renderDiscounts();
    if(screenId === 'analytics-screen' && typeof renderAnalytics === 'function') renderAnalytics();
    
    updatePauseUI();
}

function goHome() {
    exitFullscreen();
    window.location.hash = '';
    showScreen('home-screen');
}

function requestFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) { elem.requestFullscreen().catch(err => { console.log(err); }); }
    else if (elem.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); }
    else if (elem.msRequestFullscreen) { elem.msRequestFullscreen(); }
}

function exitFullscreen() {
    if (document.exitFullscreen) {
        if (document.fullscreenElement) { document.exitFullscreen().catch(err => { console.log(err); }); }
    } else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
    else if (document.msExitFullscreen) { document.msExitFullscreen(); }
}

// レジ休止状態
function togglePauseRegister() {
    playSound('click');
    isRegisterPaused = !isRegisterPaused;
    updatePauseUI();
    broadcastState();
    if (isRegisterPaused) {
        speak("レジを休止します");
    } else {
        speak("レジを再開します");
        if (document.getElementById('register-screen').classList.contains('active')) {
            const input = getJanInput();
            if (input) input.focus();
        }
    }
}

function updatePauseUI() {
    const overlay = document.getElementById('pause-overlay');
    const custOverlay = document.getElementById('customer-pause-overlay');
    const isCustActive = document.getElementById('customer-screen').classList.contains('active');
    const isRegActive = document.getElementById('register-screen').classList.contains('active');

    if (isRegisterPaused) {
        if (isCustActive) {
            if(custOverlay) custOverlay.style.display = 'flex';
            if(overlay) overlay.style.display = 'none';
        } else if (isRegActive) {
            if(overlay) {
                overlay.style.display = 'flex';
                setTimeout(() => {
                    const pInput = document.getElementById('pause-jan-input');
                    if(pInput) { pInput.value = ''; pInput.focus(); }
                }, 100);
            }
            if(custOverlay) custOverlay.style.display = 'none';
        } else {
            if(overlay) {
                overlay.style.display = 'flex';
                setTimeout(() => {
                    const pInput = document.getElementById('pause-jan-input');
                    if(pInput) { pInput.value = ''; pInput.focus(); }
                }, 100);
            }
            if(custOverlay) custOverlay.style.display = 'none';
        }
    } else {
        if(overlay) overlay.style.display = 'none';
        if(custOverlay) custOverlay.style.display = 'none';
    }
}

// カスタム確認モーダル
function showCustomConfirm(displayMsg, hiraVoiceMsg, callback, showCancel = true) {
    playSound('click');
    speak(hiraVoiceMsg);
    document.getElementById('custom-confirm-text').innerText = displayMsg;
    
    const noBtn = document.getElementById('custom-confirm-no-btn');
    const yesBtn = document.getElementById('custom-confirm-yes-btn');
    
    if (showCancel) {
        noBtn.style.display = 'block';
        yesBtn.style.flex = '1';
    } else {
        noBtn.style.display = 'none';
        yesBtn.style.flex = '1';
        yesBtn.style.width = '100%';
    }

    document.getElementById('custom-confirm-modal').style.display = 'flex';
    confirmCallback = callback;
}

function closeCustomConfirm(isYes) {
    playSound('click');
    document.getElementById('custom-confirm-modal').style.display = 'none';
    if (confirmCallback) {
        const cb = confirmCallback;
        confirmCallback = null;
        cb(isYes);
    }
}

// レシート保存フォルダ設定
async function setupReceiptFolder() {
    playSound('click');
    if ('showDirectoryPicker' in window) {
        try {
            // 書き込み権限（readwrite）を最初から要求しておく。
            // こうしておくことで、レシート保存だけでなく、データの自動バックアップ
            // （local-backup.js）もユーザー操作なしで裏側で書き込めるようになる。
            receiptDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            savedDirectoryHandle = receiptDirectoryHandle;
            saveHandleToIndexedDB(receiptDirectoryHandle);
            showCustomConfirm("レシート保存フォルダが設定されました！次回以降もレシートが自動保存されるほか、このフォルダにデータのバックアップ（haru-pos-backup.json）も自動で保存されるようになります。", "れしーと ほぞん ふぉるだ が せってい さ れ まし た！", () => {}, false);
            if (typeof writeBackupToFolderIfAvailable === 'function') writeBackupToFolderIfAvailable(true);
        } catch (err) {
            console.log(err);
        }
    } else {
        showCustomConfirm("このブラウザはフォルダの指定に対応していません。通常のダウンロードになります。", "この ぶらうざ は ふぉるだ の してい に たいおう し て い ませ ん。", () => {}, false);
    }
}

// 読み込み完了時のイベント紐付け
document.addEventListener('DOMContentLoaded', () => {
    const pauseJanInput = document.getElementById('pause-jan-input');
    if (pauseJanInput) {
        pauseJanInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = pauseJanInput.value.trim();
                if (!code) return;
                pauseJanInput.value = '';

                // セキュリティ修正：以前は '0529' や中国語簡体字の '店长' などの
                // 固定コードでも解除できてしまっていたため削除。
                // 実際に登録されているバーコードでの一致のみを許可する。
                const foundClerk = clerks.find(c => c.barcode && c.barcode === code);
                if (foundClerk) {
                    selectClerk(foundClerk.name);
                    playSound('success');
                    togglePauseRegister();
                } else {
                    playSound('error');
                    speak("バーコードが一致しません");
                }
            }
        });
    }

    const managerAuthInput = document.getElementById('manager-auth-input');
    if (managerAuthInput) {
        managerAuthInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                verifyManagerAuth();
            }
        });
    }

    const janInput = getJanInput();
    if (janInput) {
        janInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); submitInput(); }
        });
    }

    ['jan-input', 'manager-auth-input', 'new-cust-barcode', 'edit-cust-barcode-input', 'new-clerk-barcode', 'edit-clerk-barcode-input', 'new-prod-jan', 'pause-jan-input'].forEach(id => {
        applyAutoHalfWidth(id);
    });

    if (typeof populateGenreSelects === 'function') populateGenreSelects();

    // 追加：客用ディスプレイ設定チェックボックスの初期状態を反映
    const custDisplayCheck = document.getElementById('customer-display-device-check');
    if (custDisplayCheck && typeof isCustomerDisplayDevice === 'function') {
        custDisplayCheck.checked = isCustomerDisplayDevice();
    }

    checkOrientation();
});

window.addEventListener('load', () => { 
    initAbly(); 
    loadHandleFromIndexedDB();
    if (window.location.hash === '#customer') {
        openCustomerScreen();
    } else if (window.location.hash === '#clerk' || window.location.hash === '#register') {
        openRegister();
    }
});