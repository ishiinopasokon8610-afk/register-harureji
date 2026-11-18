// ==========================================
// push-notification-system.js
// ------------------------------------------
// 【この機能】
// notifications-system.js の「デスクトップ通知」を、スマホにもプッシュ通知（FCM）で届ける。
//
// 【2つの役割】
//   ■ 送る側（今までどおり、PCなどでタブを開いている端末）
//       「デスクトップ通知: ON」になっている端末で fireDesktopNotification() が呼ばれると、
//       同じ内容を pos_sync/{場所}/push_outbox/{id} にも書く。
//       すると Cloud Functions（functions/index.js）が、登録されたスマホへ送る。
//       ※ 通知の中身（商品名・金額など）は暗号化された同期データの中にしか無く、
//         Functions は読めない。そのため、通知を作る側のタブが文面を作って渡す方式にしている。
//         つまり「通知を作るタブ（PC）が開いていること」は、今までと同じく必要。
//   ■ 受け取る側（スマホ）
//       ホーム画面の「📱 スマホ通知を有効にする」を押すと、この端末のFCMトークンを
//       pos_sync/{場所}/push_tokens に登録する。
//       この端末は「受け取る専用」になり、自分では通知を送り出さない（二重送信防止）。
//       ※ スマホで「デスクトップ通知」も同時にONにすると、同じ通知が2回出る。スマホはこちらだけでよい。
//
// 【iPhone / iPad の条件】
//   Safari の「共有」→「ホーム画面に追加」で作ったアプリから開いた時だけ、プッシュ通知を受け取れる
//   （iOS 16.4 以降）。普通のSafariのタブでは有効にできない。
//
// 【Service Worker 更新時の自動再登録】
//   update-notification-system.js の「リロード」は Service Worker を一度解除するため、
//   プッシュの購読も消える。そこで、開くたびに（スマホ通知がONの端末は）トークンを取り直して登録し直す。
//
// 【導入】index.html で、notifications-system.js と firebase-sync-system.js より後ろ
//   （business-status-firebase-state-system.js の次など）に次の1行を追加する。
//        <script src="push-notification-system.js"></script>
//   ※ firebase-messaging-compat.js は、もう使わない（読み込んであっても害は無い）。
//
// 【なぜ Firebase の新しい版（12.14.0）を別に読み込むのか】
//   同じドメイン（github.io）の別のアプリが、新しい Firebase SDK（12.14以降）で通知の登録を行うと、
//   ブラウザの中の保存場所（IndexedDB の firebase-messaging-database）が「バージョン2」になる。
//   レジが使っている古い Firebase（10.14.1）は「バージョン1」で開こうとして、
//   "The requested version (1) is less than the existing version (2)" で失敗してしまう。
//   そこで、通知の登録だけは、新しい版を「別アプリ名（haru-push）」で読み込んで使う。
//   レジ本体（Realtime Database など）は今までどおり 10.14.1 のまま。
//
// 【設定】下の VAPID_KEY に、Firebaseコンソール →「プロジェクトの設定」→「Cloud Messaging」→
//   「ウェブプッシュ証明書」で作った「キーペア（公開鍵）」を貼り付ける。
// ==========================================

(function pushNotificationSystem() {
    'use strict';

    // ★ここを書き換える★
    const MODULAR_SDK_VERSION = '12.14.0'; // 通知の登録だけに使う Firebase の版（保存場所のバージョン2に対応）
    const MODULAR_APP_NAME = 'haru-push';
    const VAPID_KEY = 'BBLX6piya_nsdJqnMnnmZ4jlUox8ZSGTCAH1e7-OyifrY_A02mTi2mSpqJ5h6bfyRAfj8Nv11vLJli-PjYFZfv4';

    // pos_sync_ で始まるキーは、バックアップ・設定同期の対象外（＝他の端末に引き継がれない）。
    // 「この端末がスマホ通知の受け取り側か」は端末ごとの設定なので、必ずこの接頭辞にする。
    const FLAG_RECEIVER = 'pos_sync_push_receiver';
    const KEY_TOKEN_HASH = 'pos_sync_push_token_hash';

    const DEDUPE_BUCKET_MS = 20000; // 同じ通知を複数のPCが作っても、この枠の中なら1件にまとめる

    // 通知の本文をスマホへ送りたくないものは、タイトルの先頭（絵文字）をここに足す。
    // 例: ['🧾', '👤'] ... お会計の金額・会員名は「本文なし」で送る
    const REDACT_BODY_TITLE_PREFIXES = [];

    /* ---------- 小道具 ---------- */
    function sync() { return window.PosSync || null; }

    function syncReady() {
        const p = sync();
        return !!(p && p.isReady && p.isReady() && p.getBaseRef && p.getBaseRef());
    }

    function isReceiver() {
        try { return localStorage.getItem(FLAG_RECEIVER) === 'true'; } catch (e) { return false; }
    }

    function permissionGranted() {
        return typeof Notification !== 'undefined' && Notification.permission === 'granted';
    }

    function pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window &&
            typeof Notification !== 'undefined' &&
            typeof firebase !== 'undefined' && typeof firebase.app === 'function';
    }

    function vapidConfigured() {
        return typeof VAPID_KEY === 'string' && VAPID_KEY.length > 40 && VAPID_KEY.indexOf('ここに') === -1;
    }

    function showMsg(message, kana) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(message, kana || message, () => {}, false);
        } else {
            alert(message);
        }
    }

    // 失敗の原因が分かるように、エラーの種類（Firebaseのコード）を画面にも出す
    function errDetail(err) {
        if (!err) return '';
        const code = err.code ? String(err.code) : '';
        const msg = err.message ? String(err.message) : String(err);
        return (code ? code + ' / ' : '') + msg.slice(0, 200);
    }

    // 通知の登録用に、新しい版の Firebase を別アプリ名で読み込む（初回だけ読み込み、あとは使い回す）
    let modularPromise = null;
    function loadModularMessaging() {
        if (modularPromise) return modularPromise;
        const base = 'https://www.gstatic.com/firebasejs/' + MODULAR_SDK_VERSION + '/';
        modularPromise = Promise.all([
            import(base + 'firebase-app.js'),
            import(base + 'firebase-messaging.js')
        ]).then(([appMod, msgMod]) => {
            let app;
            try {
                app = appMod.getApp(MODULAR_APP_NAME);
            } catch (e) {
                app = appMod.initializeApp(firebase.app().options, MODULAR_APP_NAME);
            }
            return { msgMod: msgMod, messaging: msgMod.getMessaging(app) };
        }).catch((e) => {
            modularPromise = null; // 次回やり直せるようにする
            throw e;
        });
        return modularPromise;
    }

    async function sha256Hex(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    /* =========================================================
       送る側：fireDesktopNotification を包んで、push_outbox にも書く
       ========================================================= */
    async function postToOutbox(title, body, iconUrl) {
        if (isReceiver()) return; // スマホ（受け取り側）は送り出さない
        if (typeof isDesktopNotificationEnabled !== 'function' || !isDesktopNotificationEnabled()) return;
        if (!syncReady()) return; // データ用コード未設定・未接続なら何もしない
        const p = sync();

        let t = String(title || '').slice(0, 200);
        if (!t) return;
        let b = String(body || '').slice(0, 600);
        if (REDACT_BODY_TITLE_PREFIXES.some((pre) => t.startsWith(pre))) b = '';

        const bucket = Math.floor(p.serverNow() / DEDUPE_BUCKET_MS);
        const id = (await sha256Hex(t + '\n' + b + '\n' + bucket)).slice(0, 32);

        const payload = { title: t, body: b, t: firebase.database.ServerValue.TIMESTAMP };
        if (iconUrl && typeof iconUrl === 'string') payload.icon = iconUrl;
        await p.getBaseRef().child('push_outbox').child(id).set(payload);
    }

    function wrapFireDesktopNotification() {
        if (typeof window.fireDesktopNotification !== 'function') return false;
        if (window.fireDesktopNotification.__pushWrapped) return true;
        const original = window.fireDesktopNotification;
        const wrapped = function (title, body, iconUrl) {
            try {
                postToOutbox(title, body, iconUrl).catch((e) => {
                    console.warn('[push] push_outbox への書き込みに失敗しました:', e && e.message ? e.message : e);
                });
            } catch (e) { /* 通知本体の表示は止めない */ }
            return original.apply(this, arguments);
        };
        wrapped.__pushWrapped = true;
        window.fireDesktopNotification = wrapped;
        return true;
    }

    /* =========================================================
       受け取る側：FCMトークンの取得・登録・解除
       ========================================================= */
    async function registerToken() {
        const p = sync();
        if (!syncReady()) throw new Error('SYNC_NOT_READY');
        const base = p.getBaseRef();

        const reg = await navigator.serviceWorker.ready;
        const m = await loadModularMessaging();
        const token = await m.msgMod.getToken(m.messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
        if (!token) throw new Error('NO_TOKEN');

        const hash = await sha256Hex(token);
        const oldHash = localStorage.getItem(KEY_TOKEN_HASH);
        if (oldHash && oldHash !== hash) {
            await base.child('push_tokens').child(oldHash).remove().catch(() => {});
        }
        await base.child('push_tokens').child(hash).set({
            token: token,
            t: firebase.database.ServerValue.TIMESTAMP,
            ua: String(navigator.userAgent || '').slice(0, 120)
        });
        localStorage.setItem(KEY_TOKEN_HASH, hash);
    }

    async function enablePush() {
        if (typeof playSound === 'function') playSound('click');

        // ※ 通知の許可ダイアログは「ボタンを押した直後」でないと出せないため、
        //    requestPermission より前に await を挟まない。
        if (!pushSupported()) {
            showMsg(
                'この端末・ブラウザはプッシュ通知に対応していません。iPhone / iPad は、Safariの共有ボタンから「ホーム画面に追加」したアプリを開いて、もう一度お試しください。',
                'ぷっしゅ つうち に たいおう し て い ませ ん。'
            );
            return;
        }
        if (!vapidConfigured()) {
            showMsg('push-notification-system.js の VAPID_KEY（ウェブプッシュ証明書の公開鍵）が未設定です。', 'せってい が ひつよう です。');
            return;
        }
        if (!syncReady()) {
            showMsg('先に「データ用コード」を設定して、同期がつながった状態にしてください。', 'さき に データ ようこーど を せってい して ください。');
            return;
        }

        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            showMsg('通知が許可されませんでした。端末（ブラウザ）の設定から許可すると、有効にできます。', 'つうち が きょか さ れ ませ ん でし た。');
            updatePushButton();
            return;
        }

        try {
            await registerToken();
            localStorage.setItem(FLAG_RECEIVER, 'true');
            showMsg(
                'スマホ通知を有効にしました。この端末は「受け取り専用」になります（通知はPCなどのレジ画面が開いている間に作られ、ここへ届きます）。',
                'すまほ つうち を ゆうこう に し まし た。'
            );
        } catch (err) {
            console.warn('[push] トークンの登録に失敗しました:', err);
            showMsg('スマホ通知を有効にできませんでした。（詳細: ' + errDetail(err) + '）', 'ゆうこう に できま せん でし た。');
        }
        updatePushButton();
    }

    async function disablePush() {
        if (typeof playSound === 'function') playSound('click');
        const hash = localStorage.getItem(KEY_TOKEN_HASH);
        localStorage.setItem(FLAG_RECEIVER, 'false');
        localStorage.removeItem(KEY_TOKEN_HASH);
        try {
            if (hash && syncReady()) await sync().getBaseRef().child('push_tokens').child(hash).remove();
        } catch (e) { /* 失敗しても、Functions側が無効トークンとして後で掃除する */ }
        try {
            const m = await loadModularMessaging();
            await m.msgMod.deleteToken(m.messaging);
        } catch (e) { /* 無視 */ }
        updatePushButton();
    }

    /* =========================================================
       ホーム画面のボタン（「デスクトップ通知」ボタンの下に差し込む）
       ========================================================= */
    function updatePushButton() {
        const btn = document.getElementById('push-toggle-btn');
        if (!btn) return;
        if (isReceiver() && permissionGranted()) {
            btn.innerText = '📱 スマホ通知: ON（タップでOFFにする）';
            btn.onclick = disablePush;
        } else {
            btn.innerText = '📱 スマホ通知を有効にする（この端末で受け取る）';
            btn.onclick = enablePush;
        }
    }

    function ensurePushButton() {
        const anchor = document.getElementById('notif-toggle-btn');
        if (!anchor) return;
        if (!document.getElementById('push-toggle-btn')) {
            const btn = document.createElement('button');
            btn.id = 'push-toggle-btn';
            btn.className = 'home-btn full';
            btn.style.cssText = 'background:linear-gradient(to bottom,#00897b,#004d40);border-color:#00251a';
            anchor.insertAdjacentElement('afterend', btn);
        }
        updatePushButton();
    }

    /* =========================================================
       起動
       ========================================================= */
    let refreshedThisLoad = false;

    function tick() {
        ensurePushButton();
        // スマホ通知がONの端末は、開くたびにトークンを取り直す（SW解除でトークンが変わっても追従できる）
        if (!refreshedThisLoad && isReceiver() && permissionGranted() && pushSupported() && vapidConfigured() && syncReady()) {
            refreshedThisLoad = true;
            registerToken().catch((e) => {
                refreshedThisLoad = false; // つながり直したらもう一度
                console.warn('[push] トークンの再登録に失敗しました:', e && e.message ? e.message : e);
            });
        }
    }

    function init() {
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            if (wrapFireDesktopNotification() || tries > 40) clearInterval(t);
        }, 500);
        wrapFireDesktopNotification();

        tick();
        setInterval(tick, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
