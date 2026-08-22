// ==========================================
// ハイテク音声レジスター - Firebase Cloud Storage 画像管理システム
// ==========================================
// ロゴ・お会計完了画像を Cloud Storage にアップロード・管理
// 店舗ごとのデータ分離、ローカルストレージとのハイブリッド保存
// ==========================================

const FIREBASE_STORAGE_BUCKET = 'register-harureji.firebasestorage.app';

/**
 * ロゴをCloud Storageにアップロード
 * @param {File} file - アップロードするファイル
 * @param {Function} onProgress - 進捗コールバック (0-100)
 */
async function uploadShopLogoToCloud(file, onProgress = null) {
    try {
        if (!firebase || !firebase.storage) {
            console.error('Firebase Storage is not initialized');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm('Firebaseの初期化に失敗しました。', 'しゅつりょく に しっぱい しました', () => {}, true);
            }
            return false;
        }

        const shopId = getOrCreateShopId();
        const passphrase = getShopPassphrase();

        if (!passphrase) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    'クラウド保存にはパスフレーズの設定が必須です。先に「データ管理」で設定してください。',
                    'ぱすふれーず せってい が ひっす です',
                    () => {},
                    true
                );
            }
            return false;
        }

        const timestamp = new Date().getTime();
        const filename = `logo_${timestamp}.${file.name.split('.').pop()}`;
        const storagePath = getShopLogoStoragePath(filename);

        const storage = firebase.storage();
        const ref = storage.ref(storagePath);

        // メタデータに店舗情報を埋め込む（ルール側で検証可能に）
        const metadata = {
            customMetadata: {
                shopId: shopId,
                uploadedAt: new Date().toISOString(),
                uploadedBy: 'web-app',
                deviceId: POS_DEVICE_ID
            }
        };

        const uploadTask = ref.put(file, metadata);

        // 進捗を監視
        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                if (typeof onProgress === 'function') {
                    onProgress(progress);
                }
                console.log(`ロゴアップロード進捗: ${progress.toFixed(2)}%`);
            },
            (error) => {
                console.error('ロゴアップロードエラー:', error);
                if (typeof playSound === 'function') playSound('error');
                if (typeof showCustomConfirm === 'function') {
                    showCustomConfirm(
                        `クラウドアップロード失敗: ${error.message}`,
                        'あっぷろーど に しっぱい しました',
                        () => {},
                        true
                    );
                }
            },
            async () => {
                // アップロード完了
                try {
                    const downloadUrl = await ref.getDownloadURL();
                    setShopLogoUrl(downloadUrl);
                    localStorage.setItem('pos_shop_logo_url_cloud', downloadUrl);
                    
                    // UIに反映
                    const logoImg = document.getElementById('home-shop-logo');
                    const receiptLogo = document.getElementById('receipt-preview-logo');
                    if (logoImg) logoImg.src = downloadUrl;
                    if (receiptLogo) receiptLogo.src = downloadUrl;

                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                    if (typeof playSound === 'function') playSound('success');
                    if (typeof speak === 'function') speak('ろご を あっぷろーど しました');

                    console.log('✅ ロゴクラウド保存完了:', downloadUrl);
                } catch (err) {
                    console.error('ダウンロードURL取得エラー:', err);
                }
            }
        );

        return true;
    } catch (error) {
        console.error('ロゴアップロード準備エラー:', error);
        if (typeof playSound === 'function') playSound('error');
        return false;
    }
}

/**
 * ロゴをローカル/クラウド両方に保存（既存UI用）
 * @param {Event} event - input[type="file"]の change イベント
 */
async function uploadShopLogo(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof playSound === 'function') playSound('click');

    // 既存の localStorage への保存（ローカルフォールバック用）
    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        localStorage.setItem('pos_shop_logo_local', dataUrl);

        const logoImg = document.getElementById('home-shop-logo');
        const receiptLogo = document.getElementById('receipt-preview-logo');
        if (logoImg) logoImg.src = dataUrl;
        if (receiptLogo) receiptLogo.src = dataUrl;

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak('ろご を ほぞん しました');

        // Cloud Storage へのアップロードを同時進行（バックグラウンド）
        // 【修正】以前はここで pos_api_key（Ably=リアルタイム同期用のキーで、
        // Firebase Cloud Storageとは無関係）が設定されている時だけアップロードしていたため、
        // Ablyキーを使っていない店舗ではロゴがクラウドに保存されず、他端末に反映されなかった。
        // アップロード可否はFirebase側（合言葉の設定状況・firebase.storageの有無）で
        // uploadShopLogoToCloud() が自分で判断するので、ここでは無条件に呼び出す。
        await uploadShopLogoToCloud(file, (progress) => {
            console.log(`クラウドアップロード: ${progress.toFixed(2)}%`);
        });
    };
    reader.readAsDataURL(file);

    // イベントリセット
    event.target.value = '';
}

/**
 * ロゴをクリア（ローカルとクラウド両方）
 */
async function clearShopLogo() {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            'ロゴを削除しますか？',
            'ろご を さくじょ し ます か？',
            async (res) => {
                if (!res) return;

                localStorage.removeItem('pos_shop_logo_local');
                localStorage.removeItem('pos_shop_logo_url_cloud');
                localStorage.removeItem('pos_shop_logo_url');

                const logoImg = document.getElementById('home-shop-logo');
                const receiptLogo = document.getElementById('receipt-preview-logo');
                if (logoImg) logoImg.src = 'https://illust8.com/wp-content/uploads/2022/04/cash-register_16279.png';
                if (receiptLogo) receiptLogo.src = 'https://illust8.com/wp-content/uploads/2022/04/cash-register_16279.png';

                // Cloud Storage から削除
                try {
                    const shopId = getOrCreateShopId();
                    const storage = firebase.storage();
                    const logoDir = storage.ref(`shop-assets/${shopId}/logo`);
                    const result = await logoDir.listAll();
                    result.items.forEach(item => item.delete());
                    console.log('✅ クラウドロゴ削除完了');
                } catch (err) {
                    console.warn('クラウドロゴ削除エラー（ローカルは削除済み）:', err);
                }

                if (typeof playSound === 'function') playSound('success');
                if (typeof speak === 'function') speak('ろご を さくじょ しました');
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            },
            true
        );
    }
}

/**
 * お会計完了画像を Cloud Storage にアップロード
 * @param {File} file - アップロードするファイル
 * @param {Function} onProgress - 進捗コールバック (0-100)
 */
async function uploadCheckoutCompleteImageToCloud(file, onProgress = null) {
    try {
        if (!firebase || !firebase.storage) {
            console.error('Firebase Storage is not initialized');
            return false;
        }

        const shopId = getOrCreateShopId();
        const passphrase = getShopPassphrase();

        if (!passphrase) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    'クラウド保存にはパスフレーズの設定が必須です。',
                    'ぱすふれーず せってい が ひっす です',
                    () => {},
                    true
                );
            }
            return false;
        }

        const timestamp = new Date().getTime();
        const filename = `checkout-complete_${timestamp}.${file.name.split('.').pop()}`;
        const storagePath = getShopCheckoutImageStoragePath(filename);

        const storage = firebase.storage();
        const ref = storage.ref(storagePath);

        const metadata = {
            customMetadata: {
                shopId: shopId,
                uploadedAt: new Date().toISOString(),
                uploadedBy: 'web-app',
                deviceId: POS_DEVICE_ID,
                imageType: 'checkout-complete'
            }
        };

        const uploadTask = ref.put(file, metadata);

        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                if (typeof onProgress === 'function') {
                    onProgress(progress);
                }
                console.log(`お会計画像アップロード進捗: ${progress.toFixed(2)}%`);
            },
            (error) => {
                console.error('お会計画像アップロードエラー:', error);
                if (typeof playSound === 'function') playSound('error');
            },
            async () => {
                try {
                    const downloadUrl = await ref.getDownloadURL();
                    setShopCheckoutImageUrl(downloadUrl);
                    localStorage.setItem('pos_shop_checkout_image_url_cloud', downloadUrl);

                    const previewImg = document.getElementById('checkout-image-preview');
                    if (previewImg) {
                        previewImg.src = downloadUrl;
                        previewImg.style.display = 'block';
                    }

                    if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
                    if (typeof playSound === 'function') playSound('success');
                    if (typeof speak === 'function') speak('お会計かんりょう がぞう を あっぷろーど しました');

                    console.log('✅ お会計画像クラウド保存完了:', downloadUrl);
                } catch (err) {
                    console.error('ダウンロードURL取得エラー:', err);
                }
            }
        );

        return true;
    } catch (error) {
        console.error('お会計画像アップロード準備エラー:', error);
        return false;
    }
}

/**
 * お会計完了画像をローカル/クラウド両方に保存
 * @param {Event} event - input[type="file"]の change イベント
 */
async function uploadCheckoutCompleteImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof playSound === 'function') playSound('click');

    // ローカル保存
    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        localStorage.setItem('pos_shop_checkout_image_local', dataUrl);

        const previewImg = document.getElementById('checkout-image-preview');
        if (previewImg) {
            previewImg.src = dataUrl;
            previewImg.style.display = 'block';
        }

        if (typeof playSound === 'function') playSound('success');
        if (typeof speak === 'function') speak('かんりょう がぞう を ほぞん しました');

        // Cloud Storage へのアップロード
        // 【修正】ロゴと同様、pos_api_key（Ablyキー）の有無で判断していたのを廃止。
        // これが原因で、Ablyキーを設定していない客用ディスプレイ端末などでは
        // クラウドURL（getShopCheckoutImageUrl()）が一度も登録されず、
        // 客画面にお会計完了画像が表示されない不具合が起きていた。
        await uploadCheckoutCompleteImageToCloud(file, (progress) => {
            console.log(`クラウドアップロード: ${progress.toFixed(2)}%`);
        });
    };
    reader.readAsDataURL(file);

    event.target.value = '';
}

/**
 * お会計完了画像をクリア
 */
async function clearCheckoutCompleteImage() {
    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            'お会計完了画像を削除しますか？',
            'かんりょう がぞう を さくじょ し ます か？',
            async (res) => {
                if (!res) return;

                localStorage.removeItem('pos_shop_checkout_image_local');
                localStorage.removeItem('pos_shop_checkout_image_url_cloud');
                localStorage.removeItem('pos_shop_checkout_image_url');

                const previewImg = document.getElementById('checkout-image-preview');
                if (previewImg) previewImg.style.display = 'none';

                // Cloud Storage から削除
                try {
                    const shopId = getOrCreateShopId();
                    const storage = firebase.storage();
                    const imgDir = storage.ref(`shop-assets/${shopId}/checkout-images`);
                    const result = await imgDir.listAll();
                    result.items.forEach(item => item.delete());
                    console.log('✅ クラウド画像削除完了');
                } catch (err) {
                    console.warn('クラウド画像削除エラー（ローカルは削除済み）:', err);
                }

                if (typeof playSound === 'function') playSound('success');
                if (typeof speak === 'function') speak('かんりょう がぞう を さくじょ しました');
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            },
            true
        );
    }
}

/**
 * Cloud Storageからロゴを取得して表示
 */
async function loadShopLogoFromCloud() {
    try {
        const shopId = getOrCreateShopId();
        const storage = firebase.storage();
        const logoDir = storage.ref(`shop-assets/${shopId}/logo`);
        const result = await logoDir.listAll();

        if (result.items.length > 0) {
            // 最新のロゴファイルを取得
            const latestItem = result.items[result.items.length - 1];
            const downloadUrl = await latestItem.getDownloadURL();
            setShopLogoUrl(downloadUrl);

            const logoImg = document.getElementById('home-shop-logo');
            if (logoImg) logoImg.src = downloadUrl;

            console.log('✅ ロゴをクラウドから読み込み:', downloadUrl);
            return downloadUrl;
        }
    } catch (error) {
        console.warn('クラウドロゴ読み込みエラー:', error);
    }
    return null;
}

/**
 * Cloud Storageからお会計完了画像を取得して表示
 */
async function loadCheckoutImageFromCloud() {
    try {
        const shopId = getOrCreateShopId();
        const storage = firebase.storage();
        const imgDir = storage.ref(`shop-assets/${shopId}/checkout-images`);
        const result = await imgDir.listAll();

        if (result.items.length > 0) {
            // 最新の画像ファイルを取得
            const latestItem = result.items[result.items.length - 1];
            const downloadUrl = await latestItem.getDownloadURL();
            setShopCheckoutImageUrl(downloadUrl);

            const previewImg = document.getElementById('checkout-image-preview');
            if (previewImg) {
                previewImg.src = downloadUrl;
                previewImg.style.display = 'block';
            }

            console.log('✅ お会計画像をクラウドから読み込み:', downloadUrl);
            return downloadUrl;
        }
    } catch (error) {
        console.warn('クラウド画像読み込みエラー:', error);
    }
    return null;
}

/**
 * ローカルから Cloud Storage へ一括アップロード
 * （バックアップからの復元時に使用）
 */
async function syncImagesToCloud() {
    try {
        const logoLocal = localStorage.getItem('pos_shop_logo_local');
        const checkoutLocal = localStorage.getItem('pos_shop_checkout_image_local');

        if (logoLocal) {
            const blob = await (await fetch(logoLocal)).blob();
            const file = new File([blob], 'logo.png', { type: 'image/png' });
            await uploadShopLogoToCloud(file);
        }

        if (checkoutLocal) {
            const blob = await (await fetch(checkoutLocal)).blob();
            const file = new File([blob], 'checkout-complete.png', { type: 'image/png' });
            await uploadCheckoutCompleteImageToCloud(file);
        }

        console.log('✅ ローカル画像をクラウドに同期完了');
    } catch (error) {
        console.warn('画像同期エラー:', error);
    }
}

/**
 * 初期化: アプリ起動時に画像を読み込む
 */
async function initImageStorage() {
    // 1. ローカルから先に読み込む（高速）
    const logoLocal = localStorage.getItem('pos_shop_logo_local');
    const checkoutLocal = localStorage.getItem('pos_shop_checkout_image_local');

    if (logoLocal) {
        const logoImg = document.getElementById('home-shop-logo');
        if (logoImg) logoImg.src = logoLocal;
    }

    if (checkoutLocal) {
        const previewImg = document.getElementById('checkout-image-preview');
        if (previewImg) {
            previewImg.src = checkoutLocal;
            previewImg.style.display = 'block';
        }
    }

    // 2. クラウドから最新版を非同期でフェッチ（バックグラウンド）
    // 【修正】以前は pos_api_key（Ablyキー）が設定されている端末でしか
    // このフェッチ自体を行っていなかった。客用ディスプレイ専用端末など、
    // Ablyキーを設定していない端末では、他の端末がクラウドに保存した
    // お会計完了画像・ロゴが永遠に読み込まれず、客画面に写真が
    // 表示されない不具合の主な原因になっていた。
    // Firebase Storageが使えるかどうかだけを条件にする。
    setTimeout(async () => {
        if (firebase && firebase.storage) {
            const cloudLogo = await loadShopLogoFromCloud();
            const cloudCheckout = await loadCheckoutImageFromCloud();
        }
    }, 2000);
}

// DOMContentLoaded時に初期化
document.addEventListener('DOMContentLoaded', () => {
    // ロゴ・画像の読み込み
    setTimeout(initImageStorage, 500);
});
