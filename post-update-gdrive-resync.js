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
// 【今回の変更】
// 以前は、AblyのAPIキーも一緒に取り直していたが、同期をFirebaseに切り替えて
// APIキー自体が不要になったため、その処理を削除した。
// ==========================================

const LAST_SEEN_APP_VERSION_KEY = 'pos_last_seen_app_version';

function getDisplayedAppVersion() {
    const badge = document.getElementById('app-version-badge');
    return badge ? badge.innerText.trim() : null;
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
