// ==========================================
// auto-google-drive-sync.js
// ------------------------------------------
// 【背景】
// google-drive-backup.js はすでに「データが変わるたびに haruPosBackupNow() 経由で
// Google Driveへ自動バックアップする」仕組みを持っているが、
//   ・ページを開いた時に、Driveの最新データを自動で取り込む処理は無い
//     （ボタンを押した時の restoreFromGoogleDrive() のみ）
//   ・タブを閉じる/隠す瞬間に、確実にもう一度バックアップを送る一押しが無い
// ため、複数端末で使っていると「別の端末で変更した内容が、開き直しても
// 反映されない（画面が同期しない）」ことがある。
//
// 【この機能】
// ① ページを開いた時：
//    Google Driveと連携済み（pos_gdrive_connected === 'true'）であれば、
//    Drive上の最新バックアップを取得し、確認ダイアログ無しでそのまま
//    画面に反映する（＝Driveが「正」。ローカルのlocalStorageは無視する）。
//    連携していなければ、今まで通り何もしない（＝ローカルのlocalStorageを
//    そのまま使う、既存の挙動のまま）。
// ② タブを閉じる/バックグラウンドに回した時：
//    連携済みであれば、その瞬間の全データをDriveへ念のためもう一度保存する
//    （通常操作時のharuPosBackupNow経由の保存を補う「最後の一押し」）。
//
// 客用ディスプレイ端末（isCustomerDisplayDevice）は、google-drive-backup.js の
// 既存方針と同じく対象外とする（お客様の目の前でGoogle認証や上書きが
// 走らないようにするため）。
//
// google-drive-backup.js / auth-system.js は直接編集せず、
// 用意されている関数（ensureGoogleDriveToken / findGoogleDriveBackupFileId /
// gDriveApiFetch / backupToGoogleDriveNow / applyImportedDataObject）を
// そのまま利用するだけの、完全に独立したファイルとして実装する。
// ==========================================

function isGoogleDriveConnectedFlag() {
    return localStorage.getItem('pos_gdrive_connected') === 'true';
}

function isCustomerDisplaySafe() {
    return typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
}

/* =========================================================
   ① 起動時：連携済みならDriveの内容を無条件に取り込む
   ========================================================= */
async function autoRestoreFromGoogleDriveOnLoad() {
    if (isCustomerDisplaySafe()) return; // 客用ディスプレイは対象外
    if (!isGoogleDriveConnectedFlag()) return; // 未連携ならローカルのlocalStorageのまま何もしない

    if (typeof ensureGoogleDriveToken !== 'function' || typeof findGoogleDriveBackupFileId !== 'function' ||
        typeof gDriveApiFetch !== 'function') {
        return; // google-drive-backup.js がまだ読み込まれていない場合は何もしない（次回起動時に期待）
    }

    try {
        // すでに一度連携済みの端末なので、interactive=true でもGoogle側の同意画面が
        // 出るのは初回や失効時のみで、通常はサイレントにトークンが更新される想定。
        const ok = await ensureGoogleDriveToken(true);
        if (!ok) return; // トークンが取れなければ、今まで通りローカルのlocalStorageで起動を続ける

        const fileId = await findGoogleDriveBackupFileId();
        if (!fileId) return; // Drive側にまだバックアップが無い（初回等）場合は何もしない

        const res = await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
        if (!res.ok) throw new Error(`Drive取得エラー: ${res.status}`);
        const dataObj = await res.json();

        if (typeof applyImportedDataObject === 'function') {
            applyImportedDataObject(dataObj);
            console.info('Google Driveの最新データを自動で読み込みました。');
        }
    } catch (err) {
        // 自動処理なので、失敗しても画面には何も出さず、今開いているローカルのデータのまま続行する
        console.warn('起動時のGoogle Drive自動同期に失敗しました（ローカルのデータで続行します）:', err);
    }
}

(function scheduleAutoRestoreOnLoad() {
    function tryRun() {
        // auth-system.js（buildAllDataObject/applyImportedDataObject）と
        // google-drive-backup.js の両方が揃うまで待つ
        if (typeof applyImportedDataObject !== 'function' || typeof ensureGoogleDriveToken !== 'function') {
            setTimeout(tryRun, 400);
            return;
        }
        autoRestoreFromGoogleDriveOnLoad();
    }
    if (document.readyState === 'complete') {
        tryRun();
    } else {
        window.addEventListener('load', tryRun);
    }
})();

/* =========================================================
   ② タブを閉じる/隠す時：連携済みなら最後にもう一度Driveへ保存する
   ------------------------------------------
   'beforeunload' は非同期のfetchが完了する前にページが破棄されてしまい
   信頼できないため使わない。'visibilitychange' で hidden になった瞬間
   （タブを閉じる・切り替える・最小化する等、いずれも発火する）と、
   念のため 'pagehide' の両方で保存を試みる。
   ========================================================= */
function triggerFinalGoogleDriveBackup() {
    if (isCustomerDisplaySafe()) return;
    if (!isGoogleDriveConnectedFlag()) return;
    if (typeof backupToGoogleDriveNow !== 'function') return;
    backupToGoogleDriveNow(true); // silent=true（成功ポップアップ等は出さない）
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        triggerFinalGoogleDriveBackup();
    }
});

window.addEventListener('pagehide', () => {
    triggerFinalGoogleDriveBackup();
});
