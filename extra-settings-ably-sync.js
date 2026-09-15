// ==========================================
// extra-settings-ably-sync.js
// ------------------------------------------
// 【背景】
// これまでAably経由でリアルタイム同期されていたのは、
//   ・商品マスタ（pos_products）／お会計履歴（pos_history）／
//     タイムカード（pos_timecard） … sync-system.js
//   ・会員・顧客データ（pos_customers） … customer-sync-system.js
//   ・自動化バーコード（pos_discounts） … discount-system.js側で対応済み
// など「一部の決まったデータ」だけで、ホーム画面の背景・ロゴ（pos_home_bg／
// pos_shop_logo）をはじめ、時給・税設定・保留中の会計・呼び出し番号の
// カウンターなど、後から追加された数多くの設定はAably同期の対象外だった。
//
// backup-extra-settings-sync.js がGoogle Driveバックアップで採用している
// 「pos_ で始まるキーは、除外リストに無い限り自動で対象にする」という
// 方針を、Aablyのリアルタイム同期にもそのまま適用する。これにより、
// 今後 pos_ 接頭辞の新しい設定を追加しても、このファイルを一切変更せずに
// 自動でリアルタイム同期の対象になる。
//
// 【対象外にしているもの】
// ① backup-extra-settings-sync.js と同じ「この端末固有」の設定
//    （Google Drive連携状態・通知許可・ダークモード等の見た目設定・
//    　AIモデル選択・客用ディスプレイ設定など）
// ② すでに専用の同期ロジック（配列をID単位でマージする方式）を持っている
//    データ（pos_products／pos_history／pos_timecard／pos_customers／
//    pos_discounts とそれぞれの削除記録）
//    → ここでの「値が違ったら新しい方を丸ごと採用」という単純な同期を
//      これらにも適用すると、専用ロジックが防いでいた「同時編集で
//      片方の変更が消える」不具合を別の形で再発させてしまうため。
//
// 【方式】
// 各設定キーごとに「最終更新時刻」を pos_ably_settings_meta に保持し、
// 2秒ごとのポーリングで値の変化（新規追加・変更・削除）を検知したら、
// 変化したキーを1件ずつAablyへpublishする（1メッセージにまとめず、
// キーごとに分けて送ることで、仮に1件のデータサイズが大きくて送信に
// 失敗しても、他の変更まで巻き込まれないようにする）。
// 受信側は、そのキーのローカルの最終更新時刻より新しい場合だけ採用する
// （＝新しい方が勝つ。同時刻はローカル優先とし、上書きの往復ループを防ぐ）。
//
// 【注意】
// ホーム背景・ロゴのような画像（Base64）は、他の設定に比べてデータ量が
// 大きくなりやすく、Aablyのプランによってはメッセージサイズの上限に
// 引っかかって送信に失敗する場合がある。その場合はコンソールに警告が
// 出るだけで、他の同期・アプリ自体の動作は止まらない。その端末では
// Google Driveバックアップ（backup-extra-settings-sync.js経由、
// ページの開き直し時に反映）が代わりの手段になる。
//
// auth-system.js / sync-system.js / customer-sync-system.js /
// backup-extra-settings-sync.js は直接編集せず、独立したファイルとして
// 追加する（フック方式）。
// ==========================================

const ABLY_SETTINGS_SYNC_PREFIX = 'pos_';
const ABLY_SETTINGS_SYNC_META_KEY = 'pos_ably_settings_meta';

// すでに専用の同期ロジック（配列をID単位でマージする方式）を持っているため、
// ここでの単純な「新しい方を丸ごと採用」同期の対象外にするキー。
// 新しくこの種の専用同期を追加した場合は、必ずここにも追記すること。
const ABLY_SETTINGS_ALREADY_SYNCED_KEYS = [
    'pos_products', 'pos_deleted_products',   // sync-system.js
    'pos_history', 'pos_deleted_history',     // sync-system.js
    'pos_timecard',                            // sync-system.js
    'pos_customers', 'pos_deleted_customers', // customer-sync-system.js
    'pos_discounts',                            // discount-system.js（既にAably同期対応済み）
    'pos_receipt_footer_text', 'pos_receipt_footer_image',
    'pos_receipt_footer_valid_from', 'pos_receipt_footer_valid_to', // receipt-footer-system.js
    'pos_receipt_coupons',                      // receipt-coupon-system.js
    'pos_receipt_no_counter',                   // history-receipt-number-system.js（常に増加方向のみで同期する専用ロジックのため対象外）
    'pos_touch_panel_bg_url',                    // touch-panel-order-system.js（touch-panel-menu-setting-event）
    'pos_touch_panel_reco_jans',                 // touch-panel-order-system.js（touch-panel-menu-setting-event）
    'pos_touch_panel_promo_text'                 // touch-panel-order-system.js（touch-panel-menu-setting-event）
];

// touch-panel-order-system.js が商品(jan)ごとに動的にキーを増やしている設定
// （画像・説明文・バリエーション）。個別のキー名を列挙できないため、
// 前方一致の除外プレフィックスとして扱う。

// この端末固有のため、他端末に同期すると逆に困る設定
// （backup-extra-settings-sync.js の除外リストと同じ判断基準・同じキー）
const ABLY_SETTINGS_EXCLUDED_KEYS = [
    'pos_gdrive_connected',
    'pos_gdrive_last_sync_at',
    'pos_notif_enabled',
    'pos_night_mode_enabled',
    'pos_color_mode',
    'pos_ai_webllm_model_id',
    'pos_last_inactivity_nudge',
    'pos_is_customer_display',
    'pos_shop_id' // 2026-09追記：店舗ごとに意図的に別の値を持たせる設定のため、
                  // 自動同期すると他店舗の値で上書きされる事故になり得る（shop-id-system.js）
];
const ABLY_SETTINGS_EXCLUDED_PREFIXES = [
    'pos_gdrive_',
    'pos_ably_',   // このファイル自身が内部管理に使うキー（pos_ably_settings_meta等）を含む
    'pos_sync_',
    'pos_touch_panel_img_',         // touch-panel-order-system.js（商品ごとの写真。touch-panel-menu-setting-eventで同期済み）
    'pos_touch_panel_desc_',        // touch-panel-order-system.js（商品ごとの説明文。同上）
    'pos_touch_panel_variations_'   // touch-panel-order-system.js（商品ごとのバリエーション。同上）
];

function isAblySettingsSyncTarget(key) {
    if (!key || !key.startsWith(ABLY_SETTINGS_SYNC_PREFIX)) return false;
    if (ABLY_SETTINGS_ALREADY_SYNCED_KEYS.includes(key)) return false;
    if (ABLY_SETTINGS_EXCLUDED_KEYS.includes(key)) return false;
    if (ABLY_SETTINGS_EXCLUDED_PREFIXES.some(prefix => key.startsWith(prefix))) return false;
    return true;
}

function collectAblySettingsSyncTargetKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (isAblySettingsSyncTarget(k)) keys.push(k);
    }
    return keys;
}

function getAblySettingsMeta() {
    try {
        return JSON.parse(localStorage.getItem(ABLY_SETTINGS_SYNC_META_KEY) || '{}');
    } catch (e) {
        return {};
    }
}
function setAblySettingsMeta(meta) {
    localStorage.setItem(ABLY_SETTINGS_SYNC_META_KEY, JSON.stringify(meta));
}

// 受信した設定を、開いている画面があればその場で反映する。
// 個別の反映が必要な設定だけをここに追記する（無くても、次にその画面を
// 開いた時にはlocalStorageから自然に読み込まれる）。
function reapplyAblySyncedSetting(key) {
    if (key === 'pos_home_bg' && typeof applyHomeBg === 'function') {
        applyHomeBg();
    } else if (key === 'pos_shop_logo' && typeof applyShopLogo === 'function') {
        applyShopLogo();
    } else if (key === 'pos_tax_exclusive_pricing_enabled' && typeof syncTaxExclusivePricingCheckbox === 'function') {
        syncTaxExclusivePricingCheckbox();
    } else if (key === 'pos_clerk_wages' && typeof injectClerkWageCells === 'function') {
        injectClerkWageCells();
    } else if (key === 'pos_call_number_counter' && typeof refreshCallNumberDisplay === 'function') {
        refreshCallNumberDisplay();
    }
}

function broadcastAblySettingChange(key, value, updatedAt) {
    if (typeof channel === 'undefined' || !channel) return;
    try {
        channel.publish('settings-sync', {
            key: key,
            value: value, // null の場合は「削除された（初期化された）」という意味
            updatedAt: updatedAt,
            senderId: (typeof SYNC_DEVICE_ID !== 'undefined') ? SYNC_DEVICE_ID : null,
            time: Date.now()
        });
    } catch (err) {
        // 画像設定など、1件のデータが大きすぎて送信できない場合はここに来る。
        // この端末側の保存自体は既に完了しているため、動作は継続する。
        console.warn(`設定「${key}」の同期送信に失敗しました（データサイズが大きすぎる可能性があります）:`, err);
    }
}

// 前回ポーリング時点でのスナップショット（key → value の複製）
let lastKnownSettingsValues = null;

function pollAndBroadcastSettingsChanges() {
    const currentKeys = collectAblySettingsSyncTargetKeys();
    const currentMap = new Map();
    currentKeys.forEach(k => currentMap.set(k, localStorage.getItem(k)));

    if (lastKnownSettingsValues === null) {
        // 初回は基準を記録するだけ（送信はしない）
        lastKnownSettingsValues = currentMap;
        return;
    }

    const now = Date.now();
    const meta = getAblySettingsMeta();
    let metaChanged = false;

    // 値が変わった／新しく増えたキー
    currentMap.forEach((value, key) => {
        const prevValue = lastKnownSettingsValues.has(key) ? lastKnownSettingsValues.get(key) : undefined;
        if (prevValue === undefined || prevValue !== value) {
            meta[key] = now;
            metaChanged = true;
            broadcastAblySettingChange(key, value, now);
        }
    });

    // 消えたキー（初期化・リセットされた）
    lastKnownSettingsValues.forEach((prevValue, key) => {
        if (!currentMap.has(key)) {
            meta[key] = now;
            metaChanged = true;
            broadcastAblySettingChange(key, null, now);
        }
    });

    lastKnownSettingsValues = currentMap;
    if (metaChanged) setAblySettingsMeta(meta);
}

setInterval(pollAndBroadcastSettingsChanges, 2000);

// 他端末からの設定変更を受信する
(function waitForChannelAndSubscribeSettingsSync() {
    function trySubscribe() {
        if (typeof channel !== 'undefined' && channel) {
            channel.subscribe('settings-sync', (msg) => {
                if (!msg || !msg.data) return;
                const { key, value, updatedAt, senderId } = msg.data;
                if (!key || !isAblySettingsSyncTarget(key)) return; // 想定外のキーは無視（安全策）
                if (senderId && typeof SYNC_DEVICE_ID !== 'undefined' && senderId === SYNC_DEVICE_ID) return;

                const meta = getAblySettingsMeta();
                const localUpdatedAt = meta[key] || 0;
                if (!updatedAt || updatedAt <= localUpdatedAt) return; // 新しい方だけ採用

                if (value === null || value === undefined) {
                    localStorage.removeItem(key);
                    if (lastKnownSettingsValues) lastKnownSettingsValues.delete(key);
                } else {
                    localStorage.setItem(key, value);
                    if (lastKnownSettingsValues) lastKnownSettingsValues.set(key, value);
                }
                meta[key] = updatedAt;
                setAblySettingsMeta(meta);

                reapplyAblySyncedSetting(key);
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            });
        } else {
            setTimeout(trySubscribe, 500);
        }
    }
    trySubscribe();
})();
