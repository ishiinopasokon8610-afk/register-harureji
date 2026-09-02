// ==========================================
// backup-extra-settings-sync.js
// ------------------------------------------
// 【背景】
// buildAllDataObject() / applyImportedDataObject()（auth-system.js）は、
// 商品・会員・店員・履歴など「アプリの中心的なデータ」を対象に作られており、
// 後から追加された各機能が独自に持つ localStorage の項目までは
// 含まれていない。
// そのため、Google Driveへのバックアップ（google-drive-backup.js /
// auto-google-drive-sync.js）や、バックアップファイルの保存・復元を行っても、
// 以下のような「後付けの設定・データ」は保存されず、他端末で復元すると
// チェックが外れていたり、時給が空になってしまっていた
// （＝画面上・この端末では保存できているように見えても、実際に
// 　Google Driveへ送られる中身には入っていなかった）。
//
// 【この機能】
// buildAllDataObject() と applyImportedDataObject() をラップし、
// 以下の「店舗全体で共有すべき設定・データ」を追加でバックアップ対象に含める。
//   ・ pos_clerk_wages … 担当者ごとの時給（clerk-wage-system.js／給与）
//   ・ pos_tax_exclusive_pricing_enabled … 商品価格の税抜き／税込み設定
//     （tax-exclusive-pricing-system.js）
//
// 【対象外にしているもの（意図的）】
// 以下は「この端末固有」の設定のため、Google Drive経由で他端末と同期すると
// かえって困る（例：全端末が客用ディスプレイ扱いになってしまう等）。
// そのため、あえてバックアップの対象には含めない。
//   ・ pos_gdrive_connected（この端末がGoogle Driveと連携しているか）
//   ・ pos_notif_enabled（この端末でデスクトップ通知を許可しているか）
//   ・ この端末を「客用ディスプレイ」にするチェック（端末ごとの役割）
//
// 【今後、対象を追加する場合】
// EXTRA_BACKUP_LOCALSTORAGE_KEYS に localStorage のキー名を追加するだけで、
// 同じ仕組みでバックアップ／復元の対象にできる。
//
// auth-system.js は直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現する。
// ==========================================

const EXTRA_BACKUP_LOCALSTORAGE_KEYS = [
    'pos_clerk_wages',                     // 給与（担当者ごとの時給）
    'pos_tax_exclusive_pricing_enabled'    // 商品価格の税抜き／税込み設定
];

/* =========================================================
   ① buildAllDataObject() をラップし、バックアップデータに追加する
   ========================================================= */
(function hookBuildAllDataObjectForExtraSettings() {
    function tryHook() {
        if (typeof window.buildAllDataObject !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.buildAllDataObject;
        window.buildAllDataObject = function (...args) {
            const dataObj = original.apply(this, args);
            if (dataObj && typeof dataObj === 'object') {
                dataObj.extraSettings = {};
                EXTRA_BACKUP_LOCALSTORAGE_KEYS.forEach(key => {
                    const v = localStorage.getItem(key);
                    if (v !== null) dataObj.extraSettings[key] = v;
                });
            }
            return dataObj;
        };
    }
    tryHook();
})();

/* =========================================================
   ② applyImportedDataObject() をラップし、復元時にlocalStorageへ書き戻す
   ------------------------------------------
   バックアップ実施前（このファイル導入前）に作られた古いバックアップには
   extraSettings が無いので、その場合は何もしない（＝今の値をそのまま残す）。
   ========================================================= */
(function hookApplyImportedDataObjectForExtraSettings() {
    function tryHook() {
        if (typeof window.applyImportedDataObject !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.applyImportedDataObject;
        window.applyImportedDataObject = function (dataObj, ...rest) {
            const result = original.call(this, dataObj, ...rest);
            try {
                if (dataObj && dataObj.extraSettings && typeof dataObj.extraSettings === 'object') {
                    Object.keys(dataObj.extraSettings).forEach(key => {
                        // 想定していないキーは安全のため無視する
                        if (!EXTRA_BACKUP_LOCALSTORAGE_KEYS.includes(key)) return;
                        const v = dataObj.extraSettings[key];
                        if (v !== undefined && v !== null) {
                            localStorage.setItem(key, v);
                        }
                    });

                    // 画面がすでに表示されていれば、復元した内容をその場で反映する
                    if (typeof syncTaxExclusivePricingCheckbox === 'function') syncTaxExclusivePricingCheckbox();
                    if (typeof injectClerkWageCells === 'function') injectClerkWageCells();
                }
            } catch (e) {
                console.warn('追加設定（給与・税設定など）の復元に失敗しました:', e);
            }
            return result;
        };
    }
    tryHook();
})();
