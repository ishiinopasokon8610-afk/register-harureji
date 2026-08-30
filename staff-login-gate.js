// ==========================================
// staff-login-gate.js
// ------------------------------------------
// 【これまでの問題】
// simple-auth-system.js にロール（店長／店員／顧客）・権限判定の仕組みは
// 用意されていたが、実際にはどこからも呼び出されておらず、
// アプリを起動すれば誰でも（バーコード・PINなしで）レジ・タイムカード・
// 履歴・担当者管理・分析画面などをそのまま操作できてしまっていた。
//
// 【この仕組み】
// アプリ起動時に「担当者バーコード」の入力を必須にし、
// 一致した clerks（担当者管理に登録済みの人）としてログインするまで、
// 他の画面を一切操作できないようにする。
// ログインした担当者が「店長」なら店長ロール、それ以外は店員ロールとして
// simple-auth-system.js の login() に渡す。
//
// その後、showScreen() を安全にラップし、画面を開く前に必ず
//   ① ログイン済みか
//   ② その画面を開く権限があるか（canAccessScreen）
// を確認する（他の追加機能ファイルと同じ「フック方式」）。
//
// auth-system.js / ui.js / register.js は直接編集しない。
// ==========================================

let staffLoginPendingScreen = 'home-screen';

// セッションタイムアウトなど、担当者ログイン画面の上部に表示したい通知メッセージ。
// simple-auth-system.js 側から setStaffLoginNotice() 経由で設定される。
let staffLoginNoticeMessage = '';

function getStaffLoginModalEl() {
    return document.getElementById('staff-login-modal');
}

// ログイン画面（ゲート）の上に表示する通知メッセージを設定する（空文字/未指定で非表示）。
// 他のファイルからも呼べるようwindowにも公開しておく。
function setStaffLoginNotice(message) {
    staffLoginNoticeMessage = message || '';
    renderStaffLoginNotice();
}

function clearStaffLoginNotice() {
    setStaffLoginNotice('');
}

function renderStaffLoginNotice() {
    const el = document.getElementById('staff-login-notice');
    if (!el) return;
    if (staffLoginNoticeMessage) {
        el.innerText = staffLoginNoticeMessage;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

window.setStaffLoginNotice = setStaffLoginNotice;
window.clearStaffLoginNotice = clearStaffLoginNotice;

// ログイン画面（ゲート）を表示する。他の全操作をブロックする。
function showStaffLoginGate(pendingScreenId) {
    staffLoginPendingScreen = pendingScreenId || 'home-screen';

    const modal = getStaffLoginModalEl();
    if (!modal) return;

    // ログイン中は他の画面をすべて隠す（下に何か見えていると誤操作の元になるため）
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));

    modal.style.display = 'flex';
    const input = document.getElementById('staff-login-barcode-input');
    const err = document.getElementById('staff-login-error');
    if (err) err.style.display = 'none';
    renderStaffLoginNotice();
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
    }
    if (typeof speak === 'function') speak("たんとうしゃ の ばーこーど を にゅうりょく し て ください");
}

function closeStaffLoginGate() {
    const modal = getStaffLoginModalEl();
    if (modal) modal.style.display = 'none';
    clearStaffLoginNotice();
}

// ログイン試行
function attemptStaffLogin() {
    const input = document.getElementById('staff-login-barcode-input');
    const err = document.getElementById('staff-login-error');
    if (!input) return;

    const code = input.value.trim();
    if (!code) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    const foundClerk = (typeof clerks !== 'undefined' ? clerks : []).find(c => c.barcode && c.barcode === code);

    if (!foundClerk) {
        if (typeof playSound === 'function') playSound('error');
        if (err) err.style.display = 'block';
        if (typeof speak === 'function') speak("ばーこーど が いっち し ませ ん");
        input.value = '';
        input.focus();
        return;
    }

    // 「店長」という名前で登録されている担当者だけを店長ロールとして扱う
    // （verifyManagerAuth() など、既存コードの判定方法と揃えている）
    const roleId = (foundClerk.name === '店長') ? 'manager' : 'staff';

    if (typeof login === 'function') {
        login(foundClerk.name, code, roleId);
    }

    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak(`${foundClerk.name} さん、 おつかれさま です`);
    if (typeof renderAuthUI === 'function') renderAuthUI();

    closeStaffLoginGate();

    const target = staffLoginPendingScreen || 'home-screen';
    staffLoginPendingScreen = 'home-screen';
    if (typeof showScreen === 'function') showScreen(target);
}

/* =========================================================
   showScreen() を安全にラップし、ログイン状態・権限を確認する
   ========================================================= */
(function hookStaffLoginGateIntoShowScreen() {
    function tryHook() {
        if (typeof window.showScreen !== 'function' || typeof isLoggedIn !== 'function' || typeof canAccessScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        const originalShowScreen = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            if (!isLoggedIn()) {
                showStaffLoginGate(screenId);
                return;
            }

            if (!canAccessScreen(screenId)) {
                if (typeof playSound === 'function') playSound('error');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm("この画面を開く権限がありません。店長にご相談ください。", "この がめん を ひらく けんげん が あり ませ ん。", () => {}, false);
                }
                return;
            }

            if (typeof refreshSession === 'function') refreshSession();
            return originalShowScreen.apply(this, [screenId, ...rest]);
        };
    }
    tryHook();
})();

/* =========================================================
   起動時について（ブランディング要件対応）
   ------------------------------------------
   以前は起動直後に無条件でログインゲートを表示していたが、
   「ホームページがログインなしでは何も見られない」状態は
   Googleのブランディング確認等で問題として指摘されるため、
   ホーム画面（メニュー表示のみ）はログイン無しで見られるようにする。
   ログインが必要になるのは、実際にレジ・管理系の各画面を開こうとした
   タイミング（上のshowScreen()フック側）のみとする。
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('staff-login-barcode-input');
    if (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                attemptStaffLogin();
            }
        });
        if (typeof applyAutoHalfWidth === 'function') applyAutoHalfWidth('staff-login-barcode-input');
    }
});
