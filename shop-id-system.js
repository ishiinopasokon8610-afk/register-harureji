// ==========================================
// ハイテク音声レジスター - 店舗ID管理システム
// ==========================================
// 複数店舗が同じFirebaseプロジェクトを共用する際、
// データを店舗ごとに完全に分離するための店舗IDシステム
// ==========================================

const SHOP_ID_KEY = 'pos_shop_id';
const SHOP_PASSPHRASE_KEY = 'pos_shop_passphrase'; // 店舗ごとの「合言葉」
const SHOP_NAME_KEY = 'pos_shop_name';
const SHOP_LOGO_URL_KEY = 'pos_shop_logo_url';
const SHOP_CHECKOUT_IMAGE_URL_KEY = 'pos_shop_checkout_image_url';

/**
 * 店舗IDを取得、存在しなければ生成
 */
function getOrCreateShopId() {
    let shopId = localStorage.getItem(SHOP_ID_KEY);
    if (!shopId) {
        // UUIDv4風の一意なID生成
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
 * 店舗の「合言葉」(パスフレーズ)を設定
 * セキュリティ: Firestore/Storageルールで検証され、この端末専用になる
 */
function setShopPassphrase(passphrase) {
    if (!passphrase || passphrase.trim() === '') {
        console.warn('パスフレーズが空です');
        return false;
    }
    localStorage.setItem(SHOP_PASSPHRASE_KEY, passphrase);
    return true;
}

/**
 * 保存されている店舗パスフレーズを取得
 */
function getShopPassphrase() {
    return localStorage.getItem(SHOP_PASSPHRASE_KEY) || '';
}

/**
 * 店舗名を設定（表示用）
 */
function setShopName(name) {
    if (name && name.trim() !== '') {
        localStorage.setItem(SHOP_NAME_KEY, name);
    }
}

/**
 * 店舗名を取得
 */
function getShopName() {
    return localStorage.getItem(SHOP_NAME_KEY) || '店舗名未設定';
}

/**
 * ロゴURL（Cloud Storage）を保存
 */
function setShopLogoUrl(url) {
    if (url) {
        localStorage.setItem(SHOP_LOGO_URL_KEY, url);
    }
}

/**
 * ロゴURL（Cloud Storage）を取得
 */
function getShopLogoUrl() {
    return localStorage.getItem(SHOP_LOGO_URL_KEY) || '';
}

/**
 * お会計完了画像URL（Cloud Storage）を保存
 */
function setShopCheckoutImageUrl(url) {
    if (url) {
        localStorage.setItem(SHOP_CHECKOUT_IMAGE_URL_KEY, url);
    }
}

/**
 * お会計完了画像URL（Cloud Storage）を取得
 */
function getShopCheckoutImageUrl() {
    return localStorage.getItem(SHOP_CHECKOUT_IMAGE_URL_KEY) || '';
}

/**
 * 店舗IDをクリップボードにコピー
 */
function copyShopIdToClipboard() {
    const shopId = getOrCreateShopId();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shopId).then(() => {
            if (typeof playSound === 'function') playSound('success');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    `店舗ID: ${shopId}\n\nクリップボードにコピーしました。`,
                    'こぴー し まし た',
                    () => {},
                    false
                );
            }
        }).catch(() => {
            // フォールバック: テキスト選択でコピー
            const textarea = document.createElement('textarea');
            textarea.value = shopId;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        });
    }
}

/**
 * Firestoreドキュメントパス生成
 * パス: /shops/{shopId}/data/{collectionName}/{docId}
 */
function getShopDataPath(collectionName, docId) {
    const shopId = getOrCreateShopId();
    if (docId) {
        return `shops/${shopId}/data/${collectionName}/${docId}`;
    } else {
        return `shops/${shopId}/data/${collectionName}`;
    }
}

/**
 * Cloud Storage上のロゴディレクトリパス
 * パス: gs://bucket/shop-assets/{shopId}/logo/
 */
function getShopLogoStoragePath(filename = 'logo.png') {
    const shopId = getOrCreateShopId();
    return `shop-assets/${shopId}/logo/${filename}`;
}

/**
 * Cloud Storage上のお会計完了画像ディレクトリパス
 * パス: gs://bucket/shop-assets/{shopId}/checkout-images/
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
    console.log(`🔐 店舗パスフレーズ設定済み: ${getShopPassphrase() ? '○' : '×'}`);
    console.log(`📱 デバイスID: ${POS_DEVICE_ID}`);
}

/**
 * 管理画面で店舗IDと設定を表示・編集するUIを生成
 */
function renderShopIdSettings() {
    const shopId = getOrCreateShopId();
    const shopName = getShopName();
    const passphrase = getShopPassphrase();

    const container = document.getElementById('shop-id-settings-container');
    if (!container) return;

    container.innerHTML = `
        <div style="background: #e8eaf6; border: 2px solid #3f51b5; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="color: #1a237e; margin-top: 0;">🏪 店舗ID・設定</h3>
            
            <div style="margin-bottom: 12px;">
                <label style="font-weight: bold; color: #333;">店舗ID (一意・変更不可):</label>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                    <input type="text" value="${shopId}" readonly style="flex: 1; padding: 8px; background: #f5f5f5; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 12px;">
                    <button onclick="copyShopIdToClipboard()" style="flex: 0; padding: 8px 12px; background: #3f51b5; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; white-space: nowrap;">📋 コピー</button>
                </div>
                <p style="font-size: 11px; color: #666; margin: 4px 0 0 0;">複数の端末で同じ店舗を使う場合、このIDを同じにしてください（新規端末を登録する際の確認用）</p>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-weight: bold; color: #333;">店舗パスフレーズ (データアクセス制御用):</label>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                    <input type="password" id="shop-passphrase-input" placeholder="例: 12345678" value="${passphrase}" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    <button onclick="togglePassphraseVisibility('shop-passphrase-input')" style="flex: 0; padding: 8px 12px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">👁️</button>
                    <button onclick="saveShopPassphrase()" style="flex: 0; padding: 8px 12px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; white-space: nowrap;">保存</button>
                </div>
                <p style="font-size: 11px; color: #d32f2f; margin: 4px 0 0 0;">⚠️ このパスフレーズが他の端末の${getShopName()}と一致しない場合、データアクセスが制限されます（Firestore/Storageルール側で検証）</p>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-weight: bold; color: #333;">店舗名 (表示用):</label>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                    <input type="text" id="shop-name-input" placeholder="例: 山田さんコンビニ 三鷹店" value="${shopName}" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    <button onclick="saveShopName()" style="flex: 0; padding: 8px 12px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; white-space: nowrap;">保存</button>
                </div>
            </div>

            <div style="background: white; padding: 10px; border-radius: 4px; border-left: 4px solid #ff9800;">
                <p style="margin: 0; font-size: 13px; color: #555;">
                    <b>🔒 セキュリティ:</b> 
                    Firebaseの Firestore/Cloud Storage ルールで、店舗IDとパスフレーズが一致する端末からのアクセスのみ許可します。
                    したがって、このパスフレーズを安全に保つことで、自動的に他店舗のデータアクセスを防ぎます。
                </p>
            </div>
        </div>
    `;
}

function togglePassphraseVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = (input.type === 'password') ? 'text' : 'password';
}

function saveShopPassphrase() {
    const input = document.getElementById('shop-passphrase-input');
    const passphrase = input ? input.value.trim() : '';
    if (!passphrase) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('パスフレーズを入力してください。', 'ぱすふれーず を にゅうりょく し て ください', () => {}, true);
        }
        return;
    }
    setShopPassphrase(passphrase);
    localStorage.setItem('pos_shop_passphrase', passphrase);
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('ぱすふれーず を ほぞん し まし た');
    renderShopIdSettings();
}

function saveShopName() {
    const input = document.getElementById('shop-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }
    setShopName(name);
    localStorage.setItem('pos_shop_name', name);
    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
    if (typeof playSound === 'function') playSound('success');
    if (typeof speak === 'function') speak('てんぽめい を ほぞん し まし た');
    renderShopIdSettings();
}

// DOMContentLoaded時に初期化
document.addEventListener('DOMContentLoaded', () => {
    initShopIdSystem();
    const container = document.getElementById('shop-id-settings-container');
    if (container) {
        renderShopIdSettings();
    }
});
