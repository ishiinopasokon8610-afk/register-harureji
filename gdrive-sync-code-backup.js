// ==========================================
// gdrive-sync-code-backup.js
// ------------------------------------------
// 【この機能】同期用の「データ用コード」(pos_sync_code) を Google Drive のバックアップにも入れる。
//  ・保存：buildAllDataObject() の結果に syncCode を足す（Drive・ファイル保存の両方に入る）
//  ・復元：applyImportedDataObject() の後、この端末にコードがまだ無い時だけ、
//          バックアップのコードで同期を開始する（すでにコードがある端末は絶対に切り替えない）
//  ・コードを発行／入力した直後に、Driveへ最新のバックアップを送る
//  ・リアルタイム同期の対象には入れない（pos_sync_ はそちらの除外対象のまま）
// 注意：このコードは店のデータすべての鍵。Driveのファイルは共有しないこと。
// index.html で backup-extra-settings-sync.js より後ろに読み込む。
// ==========================================
(function gdriveSyncCodeBackup() {
    'use strict';

    function currentCode() {
        try { return (window.PosSync && PosSync.getCode && PosSync.getCode()) || ''; } catch (e) { return ''; }
    }

    // ① 保存
    (function hookBuild() {
        function tryHook() {
            if (typeof window.buildAllDataObject !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.buildAllDataObject.__syncCodeHooked) return;
            const original = window.buildAllDataObject;
            const wrapped = function (...args) {
                const obj = original.apply(this, args);
                try {
                    const code = currentCode();
                    if (obj && typeof obj === 'object' && code) obj.syncCode = code;
                } catch (e) { /* 無視 */ }
                return obj;
            };
            wrapped.__syncCodeHooked = true;
            window.buildAllDataObject = wrapped;
        }
        tryHook();
    })();

    // ② 復元（コードが無い端末だけ）
    (function hookApply() {
        function tryHook() {
            if (typeof window.applyImportedDataObject !== 'function') { setTimeout(tryHook, 300); return; }
            if (window.applyImportedDataObject.__syncCodeHooked) return;
            const original = window.applyImportedDataObject;
            const wrapped = function (dataObj, ...rest) {
                const result = original.call(this, dataObj, ...rest);
                try {
                    const code = dataObj && typeof dataObj.syncCode === 'string' ? dataObj.syncCode : '';
                    if (code && window.PosSync && !currentCode()) {
                        const norm = PosSync.normalizeCode(code);
                        if (norm) {
                            Promise.resolve(PosSync.applyCode(norm)).then(
                                () => console.info('Driveのバックアップから、データ用コードを復元しました。'),
                                (e) => console.warn('データ用コードの復元に失敗しました:', e && e.message ? e.message : e)
                            );
                        }
                    }
                } catch (e) { console.warn('データ用コードの復元処理でエラー:', e); }
                return result;
            };
            wrapped.__syncCodeHooked = true;
            window.applyImportedDataObject = wrapped;
        }
        tryHook();
    })();

    // ③ コードが発行・入力された直後にDriveへ送る
    window.addEventListener('pos-sync-code-changed', (ev) => {
        try {
            if (!ev || !ev.detail || !ev.detail.code) return;
            if (localStorage.getItem('pos_gdrive_connected') !== 'true') return;
            if (typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice()) return;
            if (typeof backupToGoogleDriveNow === 'function') setTimeout(() => backupToGoogleDriveNow(true), 1500);
        } catch (e) { /* 無視 */ }
    });
})();
