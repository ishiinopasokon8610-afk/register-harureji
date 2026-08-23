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
   店長セッションの永続化を「タブを閉じるまで」に限定する
   ------------------------------------------
   【残っていたなりすましの抜け道】
   Firebase Authは既定で「ブラウザを閉じても、次に開いた時も
   サインイン状態が残る（LOCAL永続化）」ようになっている。
   そのため、店長が「店長ロック」ボタンを押さずにタブだけ閉じて
   離席すると、店長としてのFirebaseセッションがブラウザに残り続けてしまう。
   この状態で別の人が devtools から
     sessionStorage.setItem('pos_manager_auth', 'true')
   を実行すると、isManagerAuthorized() の「匿名でなければOK」という
   判定をすり抜けて店長権限を得られてしまう（ローカルのフラグは
   sessionStorage＝タブを閉じると消えるが、Firebase側のセッションは
   別の仕組みで生き残ってしまうため、両者の寿命がズレていた）。

   【対策】
   認証の永続化を SESSION（そのタブを閉じたら消える）に変更し、
   ローカルのフラグ(sessionStorage)と同じ寿命に揃える。
   クラウドバックアップ用の匿名サインイン(firebase-cloud-backup.js)は
   タブを開き直すたびに自動で再サインインする作りになっているため、
   これによってバックアップ機能が止まることはない。
   ========================================================= */
(function setManagerAuthSessionPersistence() {
    function tryHook() {
        if (!isFirebaseAuthReady()) {
            setTimeout(tryHook, 300);
            return;
        }
        firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION).catch((e) => {
            console.warn('Firebase認証の永続化設定(SESSION)に失敗しました:', e);
        });
    }
    tryHook();
})();

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
                // サインイン直前に念のためもう一度SESSION永続化を指定する
                // （他の匿名サインイン処理との読み込みタイミングの前後で
                // 　万が一LOCAL永続化のまま店長セッションが張られてしまうのを防ぐため）。
                await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});

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
   【重要な修正・その1】以前はここで「isDone が false かつ currentUser がいれば無条件で signOut」
   していたため、クラウドバックアップ用の匿名セッション（isDoneは常にfalseになる）まで
   30秒おきに毎回ログアウトさせてしまい、クラウドバックアップが実質的に機能しなくなっていた
   （匿名サインイン→ほぼ即座にこのタイマーでサインアウト、の繰り返し）。
   店長セッション（匿名ではない = isAnonymous === false）だけを対象にする。

   【重要な修正・その2：なりすまし対策の強化】
   上の isDone は sessionStorage の値をそのまま見ているだけなので、
   devtoolsコンソールから
     sessionStorage.setItem('pos_manager_auth', 'true')
   を実行し続けられると、「10分経ってタイムアウトしたはずの店長セッション」を
   このチェックだけでは検知できず、居座り続けたFirebaseの店長セッションと
   組み合わさって権限を取り戻されてしまう（isDoneがtrueの間は何もしないため）。
   
   これを防ぐため、isDone（改ざん可能なローカル値）だけでなく、
   Firebaseが実際にサインインした時刻として発行する
   user.metadata.lastSignInTime（サーバー側の認証結果に基づく値で、
   sessionStorageのようにdevtoolsから単純に書き換えられるものではない）からの
   経過時間も必ず確認し、どちらか一方でも期限切れの条件を満たせば
   問答無用でサインアウトする。
   ========================================================= */
const MANAGER_FIREBASE_SESSION_MAX_MS = 10 * 60 * 1000; // auth-system.js の MANAGER_AUTH_TIMEOUT_MS と同じ値
setInterval(() => {
    if (!isFirebaseAuthReady()) return;
    const user = firebase.auth().currentUser;
    if (!user || user.isAnonymous !== false) return; // 匿名（バックアップ用）セッションは対象外

    const isDone = (typeof managerAuthDone !== 'undefined' && managerAuthDone) ||
        sessionStorage.getItem('pos_manager_auth') === 'true';

    const lastSignInMs = (user.metadata && user.metadata.lastSignInTime) ? new Date(user.metadata.lastSignInTime).getTime() : 0;
    const realElapsedMs = lastSignInMs ? (Date.now() - lastSignInMs) : Infinity;
    const isReallyExpiredByFirebase = realElapsedMs > MANAGER_FIREBASE_SESSION_MAX_MS;

    if (!isDone || isReallyExpiredByFirebase) {
        firebase.auth().signOut()
            .catch(() => {})
            .finally(() => {
                // ローカル側のフラグも念のため必ず揃えてロック状態にしておく
                if (typeof managerAuthDone !== 'undefined') managerAuthDone = false;
                sessionStorage.removeItem('pos_manager_auth');
                sessionStorage.removeItem('pos_manager_auth_time');
                if (typeof updateManagerButtonState === 'function') updateManagerButtonState();
                const apiSettings = document.getElementById('api-settings-container');
                if (apiSettings) apiSettings.style.display = 'none';

                if (typeof ensureAnonymousAuthForBackup === 'function') ensureAnonymousAuthForBackup();
            });
    }
}, 30 * 1000);

/* =========================================================
   isManagerAuthorized() に、店長用メールアドレスの一致確認を追加する
   ------------------------------------------
   これまでは「匿名でなければ店長」という判定だった。
   通常の運用ではこれで十分だが、念のための多重防御として、
   サインイン中のアカウントが本当に店長用アカウント(MANAGER_AUTH_EMAIL)
   かどうかも確認する。将来的に他の非匿名アカウント（例：顧客ログイン等）が
   同じアプリに追加された場合でも、それだけで誤って店長権限が
   与えられてしまうことがないようにするため。
   ========================================================= */
(function hardenIsManagerAuthorized() {
    function tryHook() {
        if (typeof isManagerAuthorized !== 'function' || !isFirebaseAuthReady()) {
            setTimeout(tryHook, 300);
            return;
        }

        const originalIsManagerAuthorized = isManagerAuthorized;
        window.isManagerAuthorized = function () {
            if (!originalIsManagerAuthorized()) return false;

            const user = firebase.auth().currentUser;
            // 元の判定をすでに通っている(=非匿名でサインイン済み)はずだが、念のため再確認する
            if (!user || user.isAnonymous !== false) return false;
            if (user.email !== MANAGER_AUTH_EMAIL) return false;

            return true;
        };
    }
    tryHook();
})();

/* =========================================================
   店長認証バーコード（＝Firebase Authのパスワード）の変更
   ------------------------------------------
   データ管理画面（店長認証済みでないと開けない画面）から呼び出される。
   ------------------------------------------
   【セキュリティ強化】
   以前は「この画面を開けている＝店長認証済み」というセッションの状態だけを
   根拠に、そのままupdatePassword()を呼んでいた。
   しかし店長がこの画面を開いたまま離席すると、他の人がそのまま
   バーコードを書き換えられてしまう（セッション乗っ取りに近い状態）ため、
   変更の直前に「現在のバーコード」の再入力を必須にする。
   reauthenticateWithCredential() で現在のバーコードが正しいことを
   Firebaseサーバー側で確認してから、updatePassword()を呼び出す。
   （現在のバーコードが間違っていれば、離席中の他人による変更は失敗する）
   ========================================================= */
async function changeManagerPassword() {
    const currentInputEl = document.getElementById('manager-current-barcode-input');
    const inputEl = document.getElementById('manager-new-barcode-input');
    if (!inputEl || !currentInputEl) return;
    const currentVal = currentInputEl.value.trim();
    const val = inputEl.value.trim();

    if (!/^[0-9]{4,}$/.test(currentVal)) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("確認のため、現在の店長バーコードを数字で入力してください。", "げんざい の ばーこーど を にゅうりょく し て ください。", () => {}, false);
        }
        return;
    }

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
        // まず現在のバーコードでの再認証を行う（間違っていればここで失敗する）
        const credential = firebase.auth.EmailAuthProvider.credential(MANAGER_AUTH_EMAIL, MANAGER_AUTH_PREFIX + currentVal);
        await firebase.auth().currentUser.reauthenticateWithCredential(credential);

        await firebase.auth().currentUser.updatePassword(MANAGER_AUTH_PREFIX + val);
        currentInputEl.value = '';
        inputEl.value = '';
        if (typeof playSound === 'function') playSound('success');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("店長認証バーコードを変更しました。次回からは新しいバーコードで認証してください。", "ばーこーど を へんこう し まし た。", () => {}, false);
        }
    } catch (err) {
        if (typeof playSound === 'function') playSound('error');
        if (err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials')) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("現在の店長バーコードが正しくありません。", "げんざい の ばーこーど が ちがい ます。", () => {}, false);
            }
        } else if (err && err.code === 'auth/requires-recent-login') {
            // Firebaseはパスワード変更などの機密操作に「直近のログイン」を要求することがある。
            // その場合はいったんロックし、店長認証をやり直してもらう必要がある。
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
