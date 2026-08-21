// ==========================================
// firebase-manager-auth.js
// 店長認証を Firebase Authentication に置き換える
// ------------------------------------------
// 【以前の問題】
// 店長バーコードの値が clerks配列（＝localStorage）にそのまま保存され、
// 入力値との比較もこのブラウザの中のJSだけで行われていた。
// そのため開発者ツール（F12）で
//   ・localStorageから店長バーコードの値を読み取る
//   ・verifyManagerAuth() を直接呼んで認証をスキップする
// といったことが可能だった。
//
// 【この仕組み】
// 実際の照合は Firebase のサーバー側で行われる。
// クライアント（このブラウザ）が受け取るのは「合っていたか／いなかったか」
// という結果だけで、正解の値そのものはブラウザのどこにも保存されない。
//
// 店員の操作感は今まで通り：店長バーコードをスキャン／入力するだけ。
// その値を「パスワード」としてそのまま Firebase Auth に渡している。
//
// auth-system.js は直接編集せず、他の追加機能ファイル（register-info-system.js等）
// と同じ「後から関数を安全に上書きするフック方式」で実現する。
// ==========================================

// Firebaseコンソール（Authentication > Users）で作成した、店長用のメールアドレス。
// 実在するメールアドレスである必要はない。店ごとに分かりやすい値に変更してください。
const MANAGER_AUTH_EMAIL = 'manager@haru-pos.local';

// Firebase Authenticationのパスワードは6文字以上という制約があるため、
// 4桁のバーコードの前に固定の文字列を付け足して6文字以上にしてから送信する。
// （店員が入力するバーコード自体は今まで通り4桁のままでOK。ここで自動的に変換される）
// Firebaseコンソールでユーザーを作成する際は、パスワード欄に
// 「MANAGER_AUTH_PREFIX + 実際の4桁バーコード」を入力してください。
// 例：バーコードが 1234 で、下のPREFIXが 'pos-' のままなら → パスワードは pos-1234
const MANAGER_AUTH_PREFIX = 'pos-';

function isFirebaseAuthReady() {
    return typeof firebase !== 'undefined' && typeof firebase.auth === 'function';
}

/* =========================================================
   verifyManagerAuth() を Firebase 版に置き換える
   ========================================================= */
(function overrideVerifyManagerAuth() {
    function tryHook() {
        if (typeof verifyManagerAuth !== 'function' || !isFirebaseAuthReady()) {
            setTimeout(tryHook, 300);
            return;
        }

        window.verifyManagerAuth = async function () {
            const inputEl = document.getElementById('manager-auth-input');
            const err = document.getElementById('manager-auth-error');
            if (!inputEl) return;

            const val = inputEl.value.trim();
            if (!val) {
                if (typeof playSound === 'function') playSound('error');
                return;
            }

            // 認証中の二重送信を防ぐ
            inputEl.disabled = true;

            try {
                // ここでバーコードの値（4桁）に固定PREFIXを付けてパスワード形式にし、
                // Firebaseへ送信する。実際の正誤判定はFirebaseのサーバー側で行われる。
                await firebase.auth().signInWithEmailAndPassword(MANAGER_AUTH_EMAIL, MANAGER_AUTH_PREFIX + val);

                if (typeof playSound === 'function') playSound('success');
                if (typeof closeManagerAuth === 'function') closeManagerAuth();

                if (typeof managerAuthDone !== 'undefined') managerAuthDone = true;
                sessionStorage.setItem('pos_manager_auth', 'true');
                sessionStorage.setItem('pos_manager_auth_time', Date.now().toString());

                if (typeof updateManagerButtonState === 'function') updateManagerButtonState();
                const apiSettings = document.getElementById('api-settings-container');
                if (apiSettings) apiSettings.style.display = 'block';

                if (typeof openManagerAuthTarget === 'function') {
                    openManagerAuthTarget(typeof managerAuthTarget !== 'undefined' ? managerAuthTarget : 'home');
                }
                if (typeof speak === 'function') speak("てんちょう にんしょう せいこう し まし た");
            } catch (e) {
                // auth/wrong-password（バーコード不一致）
                // auth/too-many-requests（連続失敗によるFirebase側の一時ロック。ブルートフォース対策として有効に働く）
                if (typeof playSound === 'function') playSound('error');
                if (err) err.style.display = 'block';
                if (typeof speak === 'function') speak("にんしょう しっぱい し まし た");
                console.warn('店長認証に失敗しました:', (e && e.code) || e);
            } finally {
                inputEl.disabled = false;
                inputEl.value = '';
                inputEl.focus();
            }
        };
    }
    tryHook();
})();

/* =========================================================
   lockManagerAuth() で Firebase 側のログインも解除する
   ------------------------------------------
   【重要】ここで signOut() すると、クラウドバックアップ用に張っていた
   匿名セッションも一緒に消えてしまい、以後 writeCloudBackupIfAvailable() が
   「サインインしていないので書き込まない」と判断してクラウドバックアップが
   止まってしまう。店長ロック後もバックアップが動き続けるよう、
   ログアウト後に匿名セッションを張り直す。
   ========================================================= */
(function overrideLockManagerAuth() {
    function tryHook() {
        if (typeof lockManagerAuth !== 'function' || !isFirebaseAuthReady()) {
            setTimeout(tryHook, 300);
            return;
        }

        const originalLock = lockManagerAuth;
        window.lockManagerAuth = function (...args) {
            const user = firebase.auth().currentUser;
            if (user) {
                firebase.auth().signOut()
                    .catch(() => {})
                    .finally(() => {
                        // ログアウト後、クラウドバックアップが止まらないよう匿名セッションを張り直す
                        if (typeof ensureAnonymousAuthForBackup === 'function') ensureAnonymousAuthForBackup();
                    });
            }
            return originalLock.apply(this, args);
        };
    }
    tryHook();
})();

/* =========================================================
   タイムアウト（10分）でも Firebase 側のログインを解除する
   ------------------------------------------
   auth-system.js の checkManagerAuthExpiry() は
   managerAuthDone / sessionStorage をクリアするだけなので、
   Firebase側のセッションも一緒に切るためにここでも監視する。
   ------------------------------------------
   【重要な修正】以前はここで「isDone が false かつ currentUser がいれば無条件で signOut」
   していたため、クラウドバックアップ用の匿名セッション（isDoneは常にfalseになる）まで
   30秒おきに毎回ログアウトさせてしまい、クラウドバックアップが実質的に機能しなくなっていた
   （匿名サインイン→ほぼ即座にこのタイマーでサインアウト、の繰り返し）。
   店長セッション（匿名ではない = isAnonymous === false）だけを対象にする。
   ========================================================= */
setInterval(() => {
    if (!isFirebaseAuthReady()) return;
    const isDone = (typeof managerAuthDone !== 'undefined' && managerAuthDone) ||
        sessionStorage.getItem('pos_manager_auth') === 'true';
    const user = firebase.auth().currentUser;
    if (!isDone && user && user.isAnonymous === false) {
        firebase.auth().signOut()
            .catch(() => {})
            .finally(() => {
                if (typeof ensureAnonymousAuthForBackup === 'function') ensureAnonymousAuthForBackup();
            });
    }
}, 30 * 1000);

/* =========================================================
   店長認証バーコード（＝Firebase Authのパスワード）の変更
   ------------------------------------------
   データ管理画面（店長認証済みでないと開けない画面）から呼び出される。
   すでにログイン済みのセッションに対して updatePassword() を呼ぶだけなので、
   古いバーコードの値をどこにも保存・比較する必要がない。
   ========================================================= */
async function changeManagerPassword() {
    const inputEl = document.getElementById('manager-new-barcode-input');
    if (!inputEl) return;
    const val = inputEl.value.trim();

    if (!/^[0-9]{4,}$/.test(val)) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("新しいバーコードは数字4桁以上で入力してください。", "すうじ で にゅうりょく し て ください。", () => {}, false);
        }
        return;
    }

    if (!isFirebaseAuthReady() || !firebase.auth().currentUser) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("バーコードの変更には、店長認証がお済みの状態である必要があります。", "てんちょう にんしょう が ひつよう です。", () => {}, false);
        }
        return;
    }

    try {
        await firebase.auth().currentUser.updatePassword(MANAGER_AUTH_PREFIX + val);
        inputEl.value = '';
        if (typeof playSound === 'function') playSound('success');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("店長認証バーコードを変更しました。次回からは新しいバーコードで認証してください。", "ばーこーど を へんこう し まし た。", () => {}, false);
        }
    } catch (err) {
        if (typeof playSound === 'function') playSound('error');
        // Firebaseはパスワード変更などの機密操作に「直近のログイン」を要求することがある。
        // その場合はいったんロックし、店長認証をやり直してもらう必要がある。
        if (err && err.code === 'auth/requires-recent-login') {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    "セキュリティのため、変更前にもう一度店長認証が必要です。「店長ロック」→もう一度「店長認証」をしてから、再度お試しください。",
                    "もう いちど てんちょう にんしょう を し て ください。",
                    () => {}, false
                );
            }
        } else {
            console.warn('店長認証バーコードの変更に失敗しました:', err);
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("バーコードの変更に失敗しました。", "へんこう に しっぱい し まし た。", () => {}, false);
            }
        }
    }
}
