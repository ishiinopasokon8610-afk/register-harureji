// ==========================================
// ハイテク音声レジスター - 店舗ID管理システム
// ==========================================
// 複数店舗が同じFirebaseプロジェクトを共用する際、
// データ（ロゴ・お会計完了画像など）を店舗ごとに分離するための店舗IDシステム
// ------------------------------------------
// 【2026-08 変更】
// 「店舗ID・設定」画面（店舗ID表示・パスフレーズ変更・復元UI）は削除しました。
// レジ本体のデータはGoogle API側に移行済みのため不要と判断。
// ただし firebase-image-storage.js（ロゴ・お会計完了画像のアップロード）は
// まだ Firebase Storage を使っており、店舗ID・パスフレーズをそのまま参照するため、
// その2つに必要な最小限の関数だけをここに残しています。
//
// ⚠️ 今後、パスフレーズの変更・店舗IDの復元（キャッシュ削除時の引き継ぎ）はできません。
// もし画像アップロード機能もFirebaseから移行する場合は、このファイル自体を
// 丸ごと削除して問題ありません（その際はindex.html側のscriptタグも忘れずに）。
// ==========================================

const SHOP_ID_KEY = 'pos_shop_id';
const SHOP_PASSPHRASE_KEY = 'pos_shop_passphrase';
const SHOP_LOGO_URL_KEY = 'pos_shop_logo_url';
const SHOP_CHECKOUT_IMAGE_URL_KEY = 'pos_shop_checkout_image_url';

/**
 * 店舗IDを取得、存在しなければ生成
 */
function getOrCreateShopId() {
    let shopId = localStorage.getItem(SHOP_ID_KEY);
    if (!shopId) {
        shopId = generateShopId();
        localStorage.setItem(SHOP_ID_KEY, shopId);
    }
    return shopId;
}

/**
 * 店舗IDを生成（UUIDv4スタイル）
 */
function generateShopId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2);
    const machineId = navigator.userAgent.split(' ').length.toString(36);
    return `shop_${timestamp}_${random}_${machineId}`;
}

/**
 * 保存されている店舗パスフレーズを取得
 * （firebase-image-storage.js がアップロード可否の判定に使用）
 */
function getShopPassphrase() {
    return localStorage.getItem(SHOP_PASSPHRASE_KEY) || '';
}

/**
 * ロゴURL（Cloud Storage）を保存・取得
 */
function setShopLogoUrl(url) {
    if (url) {
        localStorage.setItem(SHOP_LOGO_URL_KEY, url);
    }
}
function getShopLogoUrl() {
    return localStorage.getItem(SHOP_LOGO_URL_KEY) || '';
}

/**
 * お会計完了画像URL（Cloud Storage）を保存・取得
 */
function setShopCheckoutImageUrl(url) {
    if (url) {
        localStorage.setItem(SHOP_CHECKOUT_IMAGE_URL_KEY, url);
    }
}
function getShopCheckoutImageUrl() {
    return localStorage.getItem(SHOP_CHECKOUT_IMAGE_URL_KEY) || '';
}

/**
 * Cloud Storage上のロゴディレクトリパス
 */
function getShopLogoStoragePath(filename = 'logo.png') {
    const shopId = getOrCreateShopId();
    return `shop-assets/${shopId}/logo/${filename}`;
}

/**
 * Cloud Storage上のお会計完了画像ディレクトリパス
 */
function getShopCheckoutImageStoragePath(filename = 'checkout-complete.png') {
    const shopId = getOrCreateShopId();
    return `shop-assets/${shopId}/checkout-images/${filename}`;
}

/**
 * 店舗IDシステムの初期化（DOMContentLoaded時に呼び出す）
 */
function initShopIdSystem() {
    const shopId = getOrCreateShopId();
    console.log(`🏪 店舗ID: ${shopId}`);
    console.log(`📱 デバイスID: ${typeof POS_DEVICE_ID !== 'undefined' ? POS_DEVICE_ID : '(未定義)'}`);
}

document.addEventListener('DOMContentLoaded', () => {
    initShopIdSystem();
});
