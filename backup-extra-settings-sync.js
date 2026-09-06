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
//   ・ pos_discounts … 自動化バーコード（割引・商品自動追加）の登録内容
//     （discount-system.js／home-automation-blocks.js）
//   ・ pos_call_number_counter … 呼び出し番号の現在のカウンター
//     （call-number-system.js）
//   ・ pos_held_sales … 保留中の会計（hold-sale-system.js）
//   ・ pos_last_order_display … お渡し前の注文キュー
//     （order-checkout-display.js）
//   ・ pos_ai_analysis_saved_history … 保存したAI店舗分析の履歴
//     （ai-store-analysis-system.js）
//   ・ pos_touch_panel_bg_url / pos_touch_panel_img_で始まる各キー
//     … タッチパネル注文画面の背景・商品画像設定（touch-panel-order-system.js）
//     （画像の枚数分だけキーが増減するため、固定のキー名一覧ではなく
//     　前方一致で対象を集める）
//
// 【対象外にしているもの（意図的）】
// 以下は「この端末固有」の設定のため、Google Drive経由で他端末と同期すると
// かえって困る（例：全端末が客用ディスプレイ扱いになってしまう等）。
// そのため、あえてバックアップの対象には含めない。
//   ・ pos_gdrive_connected（この端末がGoogle Driveと連携しているか）
//   ・ pos_gdrive_last_sync_at（この端末で最後にGoogle Drive同期した時刻）
//   ・ pos_notif_enabled（この端末でデスクトップ通知を許可しているか）
//   ・ pos_night_mode_enabled / pos_color_mode（この端末の画面の見た目設定）
//   ・ pos_ai_webllm_model_id（この端末で選んでいるAIモデル。端末の
//     　性能に合わせて選ぶものなので、他端末に強制すると重すぎる／
//     　動かない場合があるため）
//   ・ pos_last_inactivity_nudge（通知の再送間隔を内部的に管理するための
//     　タイムスタンプで、設定でも業務データでもないため）
//   ・ この端末を「客用ディスプレイ」にするチェック（端末ごとの役割）
//
// 【今後、除外を追加したい場合】
// pos_ で始まるキーは自動的にバックアップ対象になるため、通常は何もしなくてよい。
// 逆に「この端末固有なので同期したくない」設定を新しく追加した場合のみ、
// EXTRA_BACKUP_EXCLUDED_KEYS（固定キー）または
// EXTRA_BACKUP_EXCLUDED_PREFIXES（前方一致）に追記する。
//
// auth-system.js は直接編集せず、他の追加機能ファイルと同じ「フック方式」で実現する。
// ==========================================

// 【今回変更】これまでは「対象キーを1件ずつ手で追加していく」方式だったため、
// 新しい機能が増えるたびにこのファイルを更新し忘れると、その機能のデータだけ
// Google Driveに上がらない、という抜け漏れが起き続けていた。
// そこで方針を反転させ、「pos_ で始まるlocalStorageのキーは、原則すべて
// バックアップ対象にする」に変更する。対象外にしたいもの（＝この端末固有の
// 設定で、他端末に同期するとかえって困るもの）だけを下の除外リストに書く。
// これにより、今後 pos_ 接頭辞のキーを使う新機能を追加しても、このファイルを
// 一切変更せずに自動でバックアップ／復元の対象になる。
const EXTRA_BACKUP_LOCALSTORAGE_PREFIX = 'pos_';

// 【この端末固有】のため、あえてバックアップ・他端末への同期の対象に含めないキー
// （固定キー・前方一致どちらでも指定できる）
const EXTRA_BACKUP_EXCLUDED_KEYS = [
    'pos_gdrive_connected',        // この端末がGoogle Driveと連携しているか
    'pos_gdrive_last_sync_at',     // この端末で最後にGoogle Drive同期した時刻
    'pos_notif_enabled',           // この端末でデスクトップ通知を許可しているか
    'pos_night_mode_enabled',      // この端末の画面の見た目設定（ダークモード）
    'pos_color_mode',              // この端末の画面の見た目設定（配色）
    'pos_ai_webllm_model_id',      // この端末で選んでいるAIモデル（端末の性能に依存するため）
    'pos_last_inactivity_nudge',   // 通知の再送間隔を内部管理するタイムスタンプ（設定でも業務データでもない）
    'pos_is_customer_display'      // この端末を「客用ディスプレイ」にする設定（端末ごとの役割）
];
const EXTRA_BACKUP_EXCLUDED_PREFIXES = [
    'pos_gdrive_',                 // Google Drive連携に関する、この端末のトークン等の内部状態
    'pos_ably_',                   // Ably同期に関する、この端末の接続状態等の内部状態
    'pos_sync_'                    // 同期処理そのものが内部管理に使う、この端末のスナップショット等
];

function isExcludedFromExtraBackup(key) {
    if (EXTRA_BACKUP_EXCLUDED_KEYS.includes(key)) return true;
    return EXTRA_BACKUP_EXCLUDED_PREFIXES.some(prefix => key.startsWith(prefix));
}

// 対象キーをすべて集める（pos_で始まる かつ 除外リストに該当しないもの）
function collectExtraBackupTargetKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(EXTRA_BACKUP_LOCALSTORAGE_PREFIX)) continue;
        if (isExcludedFromExtraBackup(k)) continue;
        keys.push(k);
    }
    return keys;
}

// 復元時、想定していないキー（pos_で始まらない・除外対象）を書き戻して
// しまわないための判定
function isAllowedExtraBackupKey(key) {
    if (!key || !key.startsWith(EXTRA_BACKUP_LOCALSTORAGE_PREFIX)) return false;
    return !isExcludedFromExtraBackup(key);
}

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
                collectExtraBackupTargetKeys().forEach(key => {
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
                        if (!isAllowedExtraBackupKey(key)) return;
                        const v = dataObj.extraSettings[key];
                        if (v !== undefined && v !== null) {
                            localStorage.setItem(key, v);
                        }
                    });

                    // 画面がすでに表示されていれば、復元した内容をその場で反映する
                    if (typeof syncTaxExclusivePricingCheckbox === 'function') syncTaxExclusivePricingCheckbox();
                    if (typeof injectClerkWageCells === 'function') injectClerkWageCells();
                    if (typeof discountBarcodes !== 'undefined' && dataObj.extraSettings.pos_discounts) {
                        try {
                            discountBarcodes.length = 0;
                            JSON.parse(dataObj.extraSettings.pos_discounts).forEach(d => discountBarcodes.push(d));
                            if (document.getElementById('discount-tbody') && typeof renderDiscounts === 'function') renderDiscounts();
                            if (typeof renderHomeAutomationBlocksIfVisible === 'function') renderHomeAutomationBlocksIfVisible();
                        } catch (e) { /* 無視 */ }
                    }
                }
            } catch (e) {
                console.warn('追加設定（給与・税設定・自動化バーコードなど）の復元に失敗しました:', e);
            }
            return result;
        };
    }
    tryHook();
})();
