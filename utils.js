function checkPointExpiry(cust) {
    if (!cust || !cust.points || cust.points <= 0) return { expired: false, expiringSoon: false, daysLeft: 365 };
    const updatedAt = cust.pointsUpdatedAt ? new Date(cust.pointsUpdatedAt).getTime() : Date.now();
    const expiryDate = updatedAt + (365 * 24 * 60 * 60 * 1000);
    const now = Date.now();
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    if (daysLeft <= 0) {
        return { expired: true, expiringSoon: false, daysLeft: 0 };
    } else if (daysLeft <= 30) {
        return { expired: false, expiringSoon: true, daysLeft: daysLeft };
    }
    return { expired: false, expiringSoon: false, daysLeft: daysLeft };
}

function calculateAge(cust) {
    if (cust && cust.birthday) {
        const birthDate = new Date(cust.birthday);
        if (!isNaN(birthDate.getTime())) {
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            return age;
        }
    }
    return (cust && cust.age !== undefined) ? cust.age : 0;
}

function speak(text) {
    const currentClerk = clerks.find(c => c.name === activeClerkName);
    if (currentClerk && currentClerk.voiceEnabled === false) {
        return;
    }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const uttr = new SpeechSynthesisUtterance(text);
        uttr.lang = 'ja-JP';
        uttr.volume = 1.0;
        window.speechSynthesis.speak(uttr);
    }
}

function speakVoice(text) {
    playSound('click');
    speak(text);
    if (document.getElementById('register-screen').classList.contains('active')) {
        const input = getJanInput();
        if (input) input.focus();
    }
}

function playSound(type) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'beep') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'click') {
        osc.type = 'square'; osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        osc.start(); osc.stop(audioCtx.currentTime + 0.05);
    } else if (type === 'success') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
        osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'error') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
        osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    }
}

// 時計の常時更新
setInterval(() => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const clockEl = document.getElementById('global-clock');
    if (clockEl) clockEl.innerText = timeStr;
}, 1000);

let isComposing = false;
function autoHalfWidth(e) {
    if (isComposing) return;
    const el = e.target;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const converted = el.value.replace(/[Ａ-Ｚａ-ｚ０-９！-～]/g, function(s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).replace(/ /g, ' ');
    if (el.value !== converted) {
        el.value = converted;
        el.setSelectionRange(start, end);
    }
}

function applyAutoHalfWidth(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.addEventListener('compositionstart', () => { isComposing = true; });
        el.addEventListener('compositionend', (e) => {
            isComposing = false;
            autoHalfWidth(e);
        });
        el.addEventListener('input', autoHalfWidth);
    }
}

// 画面スリープ防止 (Wake Lock)
let wakeLock = null;
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (err) { console.error(err); }
    }
}
requestWakeLock();
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') { await requestWakeLock(); }
});

// Undo / Redo ショートカット
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (cartHistory.length > 0) {
            redoStack.push(JSON.parse(JSON.stringify(cart)));
            cart = cartHistory.pop();
            updateReceipt();
            playSound('click');
            speak("まえ に もどし まし た");
        } else {
            playSound('error');
            speak("これ以上戻せません");
        }
    } else if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (redoStack.length > 0) {
            cartHistory.push(JSON.parse(JSON.stringify(cart)));
            cart = redoStack.pop();
            updateReceipt();
            playSound('click');
            speak("つぎ に すすみ まし た");
        } else {
            playSound('error');
            speak("これ以上進めません");
        }
    }
});

function initAbly() {
    const apiKey = document.getElementById('api-key-input').value.trim();
    if (!apiKey) return;
    try {
        if (typeof Ably !== 'undefined' && !ably) {
            ably = new Ably.Realtime({ key: apiKey });
            channel = ably.channels.get('hightech-pos-channel');
            channel.subscribe('update-cart', (message) => {
                cart = message.data.cart;
                currentTotal = message.data.total;
                billingAmount = message.data.billing || currentTotal;
                currentDeposit = message.data.deposit || 0;
                currentChange = message.data.change || 0;
                usedPoints = message.data.pointsUsed || 0;
                isRegisterPaused = !!message.data.isPaused;
                lastScannedBarcode = message.data.lastBarcode || "";
                updatePauseUI();
                updateCustomerDisplay();
            });

            channel.subscribe('age-check-event', (message) => {
                const data = message.data;
                if (data.action === 'start') {
                    pendingAgeCheckItem = data.item;
                    showAgeCheckModals();
                } else if (data.action === 'cancel') {
                    onAgeCheckCancel();
                } else if (data.action === 'success') {
                    onAgeCheckSuccess();
                }
            });
        }
    } catch (e) { console.error(e); }
}

function broadcastState() {
    if (channel) {
        channel.publish('update-cart', { 
            cart: cart, 
            total: currentTotal, 
            billing: billingAmount,
            deposit: currentDeposit, 
            change: currentChange,
            pointsUsed: usedPoints,
            isPaused: isRegisterPaused,
            lastBarcode: lastScannedBarcode
        });
    }
}

// ネットワーク切断・復帰の自動検知
window.addEventListener('offline', () => {
    playSound('error');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("インターネットに接続していません", "いんたーねっと に せつぞく し て い ませ ん", () => {}, false);
    }
});

window.addEventListener('online', () => {
    playSound('success');
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm("オンラインに復旧しました！", "おんらいん に ふっきゅう し まし た！", () => {}, false);
    }
});

// 縦画面・横画面の強制判定
function checkOrientation() {
    const overlay = document.getElementById('orientation-overlay');
    if (!overlay) return;
    const isPortrait = window.innerHeight > window.innerWidth;
    const isMobileSize = window.innerWidth <= 1024; 
    if (isPortrait && isMobileSize) {
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);