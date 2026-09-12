// ==========================================
// post-update-gdrive-resync.js
// ------------------------------------------
// 【背景】
// update-notification-system.js の通知の「リロード」ボタンで新しい
// バージョンに更新した直後、auto-google-drive-sync.js の
// 「起動時にGoogle Driveの最新データを取り込む」処理は、
// 1タブ・1セッションにつき一度しか実行しない仕組み
// （sessionStorageの pos_gdrive_autorestore_done）になっている。
// リロードは同じタブ・同じセッションの継続とみなされるため、
// このままだと「アップデートを反映した直後の再読み込み」（sw.jsが
// 古いキャッシュを削除した直後）では、Google Driveの最新データが
// 再取得されない可能性がある。
//
// 【この機能】
// 画面左下のバージョン表示（update-notification-system.jsが表示する
// #app-version-badge）を使い、「前回このタブで見ていたバージョン」と
// 「今表示されているバージョン」をlocalStorageで比較する。
// 違っていれば「アップデートを反映した直後の初回起動」と判断し、
// auto-google-drive-sync.js側の1セッション1回のガードを解除したうえで、
// Google Driveの最新データ取り込みを改めて実行する。
// （Google Drive未連携・客用ディスプレイ端末の場合は、
//   auto-google-drive-sync.js側の判定により何も起きない）
//
// 【今回の強化：APIキー（Ably）も一緒に取り直す】
// これまではGoogle Driveのデータだけを取り直していたが、
// index.html側が持つAbly用APIキー（Firestoreの pos_realtime_settings
// から読み込む方式）も、ページを開きっぱなしのまま長時間経ってから
// アップデートが反映されたようなケースでは、念のため最新の値に
// 取り直しておきたい。index.htmlが用意している
// window.getPosApiKeyAsync()（＝loadPosApiKeyFromFirestoreの公開版）を
// 使って再取得し、window.POS_ABLY_API_KEY を更新したうえで、
// 他ファイルが待ち受けている 'pos-ably-key-ready' イベントを
// 改めて発火させる。こちらもindex.html / auto-google-drive-sync.jsを
// 直接編集せず、既存の公開関数・イベントを読み取って利用するだけの
// 独立したファイルとして実装する。
// ==========================================

const LAST_SEEN_APP_VERSION_KEY = 'pos_last_seen_app_version';

function getDisplayedAppVersion() {
    const badge = document.getElementById('app-version-badge');
    return badge ? badge.innerText.trim() : null;
}

async function resyncPosApiKeyAfterUpdate() {
    if (typeof window.getPosApiKeyAsync !== 'function') return; // index.html側が未準備

    try {
        const key = await window.getPosApiKeyAsync();
        if (key) {
            window.POS_ABLY_API_KEY = key;
            window.dispatchEvent(new CustomEvent('pos-ably-key-ready', { detail: { apiKey: key } }));
            console.info('アップデートを検知したため、Ably用APIキーを最新の状態に取り直しました。');
        }
    } catch (e) {
        console.warn('アップデート後のAPIキー再取得に失敗しました:', e);
    }
}

function checkVersionChangeAndResyncGoogleDrive() {
    const currentVersion = getDisplayedAppVersion();
    if (!currentVersion) return; // バージョン表示バッジがまだ無い＝準備未完了

    const lastSeenVersion = localStorage.getItem(LAST_SEEN_APP_VERSION_KEY);

    // 前回このタブで見ていたバージョンと違う＝アップデートを反映した直後の初回起動
    if (lastSeenVersion && lastSeenVersion !== currentVersion) {
        try { sessionStorage.removeItem('pos_gdrive_autorestore_done'); } catch (e) {}

        if (typeof autoRestoreFromGoogleDriveOnLoad === 'function') {
            console.info(`アップデートを検知しました（${lastSeenVersion} → ${currentVersion}）。Google Driveの最新データを確認します。`);
            autoRestoreFromGoogleDriveOnLoad();
        }

        resyncPosApiKeyAfterUpdate();
    }

    localStorage.setItem(LAST_SEEN_APP_VERSION_KEY, currentVersion);
}

(function scheduleVersionCheck() {
    function tryRun() {
        // update-notification-system.js がバージョンバッジを表示し終えるまで待つ
        if (!document.getElementById('app-version-badge')) {
            setTimeout(tryRun, 500);
            return;
        }
        checkVersionChangeAndResyncGoogleDrive();
    }
    if (document.readyState === 'complete') {
        tryRun();
    } else {
        window.addEventListener('load', tryRun);
    }
})();
