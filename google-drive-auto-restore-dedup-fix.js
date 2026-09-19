// ==========================================
// google-drive-auto-restore-dedup-fix.js
// ------------------------------------------
// 【背景】
// auto-google-drive-sync.js の autoRestoreFromGoogleDriveOnLoad() は、
// Google Driveと連携済みであれば、ページを開く（＝新しいタブ・セッションが
// 始まる）たびに、Drive上のバックアップを無条件で取得して
// applyImportedDataObject() に渡している。
//
// applyImportedDataObject() は json-export-import-system.js の手動インポート
// などとも共用している auth-system.js 側の関数で、取り込み完了時に
// 「データの取り込みが完了しました」といった通知を出す作りになっている。
//
// この2つが組み合わさると、Drive側の中身が前回から何も変わっていなくても、
// アプリを開き直すたび（特にスマホでPWAとして使っている場合、OSがバックグラウンド
// のページを破棄しやすく、開き直すたびに新しいセッション扱いになりやすい）に
// 毎回「取り込み完了」の通知が出てしまい、「ずっと出てくる」ように見える。
//
// 【この機能】
// auto-google-drive-sync.js / auth-system.js は直接編集せず、他の追加機能
// ファイルと同じ「フック方式」で、以下の2つの既存関数だけをラップする。
//   ① autoRestoreFromGoogleDriveOnLoad() … 実行中かどうかのフラグを立てる
//   ② applyImportedDataObject() … ①の実行中だけ、Driveバックアップの
//      保存時刻（dataObj.savedAt。restoreFromGoogleDrive()が確認ダイアログの
//      表示に使っているのと同じ値）を見て、前回自動取り込みした時と同じ
//      内容であれば、実際の取り込み処理（＝通知の表示も含む）自体を
//      呼ばずにスキップする。
// 手動の「📥 Driveから復元」ボタンや、json-export-import-system.js の
// ファイルからの復元では、このフラグは立たないため、これまで通り
// 毎回きちんと取り込み・通知が行われる（無条件に上書きしたい時の動作は
// 変えない）。
//
// 前回取り込んだ時刻を覚えておくキーは 'pos_gdrive_' で始まる名前にして
// あるため、backup-extra-settings-sync.js / extra-settings-ably-sync.js の
// 既存の除外ルール（pos_gdrive_ prefixは対象外）により、追加の設定なしで
// Google Driveバックアップや端末間のAably同期の対象からも自動的に外れる
// （＝この端末だけのローカルな管理情報として扱われる）。
//
// 【今回の訂正】
// 「取り込み済み」の記録（pos_gdrive_last_imported_savedat）は、取り込みを
// 行う「前」ではなく、取り込みが例外なく終わった「後」に行うようにした。
// 取り込みの途中でエラーになった場合は記録されないので、次に開いた時に
// もう一度取り込みを試みる（以前は、失敗しても記録され、Driveの内容が
// 更新されるまでスキップされ続けていた）。
// ※applyImportedDataObject() の中でエラーを握りつぶして画面に表示するだけの
//   作りになっている場合は、この対応では失敗を検知できない（呼び出し側からは
//   成功と区別できないため）。
// ==========================================

(function fixGoogleDriveAutoRestoreDuplicateNotice() {
    const GDRIVE_LAST_IMPORTED_SAVEDAT_KEY = 'pos_gdrive_last_imported_savedat';

    function tryHook() {
        if (typeof window.autoRestoreFromGoogleDriveOnLoad !== 'function' ||
            typeof window.applyImportedDataObject !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }

        // ①「起動時のGoogle Drive自動復元」が今まさに実行中かどうかのフラグ
        let insideAutoRestore = false;

        const originalAutoRestore = window.autoRestoreFromGoogleDriveOnLoad;
        window.autoRestoreFromGoogleDriveOnLoad = async function (...args) {
            insideAutoRestore = true;
            try {
                return await originalAutoRestore.apply(this, args);
            } finally {
                insideAutoRestore = false;
            }
        };

        // ② applyImportedDataObject() をラップし、①の実行中だけ重複チェックを行う
        const originalApplyImported = window.applyImportedDataObject;
        window.applyImportedDataObject = function (dataObj, ...rest) {
            if (!insideAutoRestore) {
                // 手動の「📥 Driveから復元」・ファイルからの復元など：これまで通り毎回取り込む
                return originalApplyImported.call(this, dataObj, ...rest);
            }

            const incomingSavedAt = (dataObj && dataObj.savedAt) ? String(dataObj.savedAt) : null;
            const alreadyImported = incomingSavedAt &&
                localStorage.getItem(GDRIVE_LAST_IMPORTED_SAVEDAT_KEY) === incomingSavedAt;

            if (alreadyImported) {
                // 前回の自動取り込みと同じ内容＝実質何も変わっていないので、
                // 取り込み処理自体（＝完了通知の表示も含む）を行わずに終える
                console.info('Google Driveの内容は前回の自動取り込み時から変わっていないため、今回はスキップしました。');
                return;
            }

            // 【不具合修正】以前は、取り込みを行う「前」に保存時刻を記録していたため、
            // 取り込みの途中でエラー（例外）になっても「取り込み済み」と記録されてしまい、
            // Driveの内容が更新されるまで、次回以降ずっとスキップされ続けていた。
            // 取り込みが例外なく終わった「後」で記録するように変更する
            // （取り込みが非同期（Promise）の場合は、完了した後に記録する）。
            const markImported = () => {
                if (!incomingSavedAt) return;
                try {
                    localStorage.setItem(GDRIVE_LAST_IMPORTED_SAVEDAT_KEY, incomingSavedAt);
                } catch (e) {
                    console.warn('Google Driveの取り込み時刻の記録に失敗しました:', e);
                }
            };

            const result = originalApplyImported.call(this, dataObj, ...rest); // 例外はそのまま上に伝わる（記録しない）
            if (result && typeof result.then === 'function') {
                return result.then((value) => {
                    markImported();
                    return value;
                });
            }
            markImported();
            return result;
        };
    }

    tryHook();
})();
