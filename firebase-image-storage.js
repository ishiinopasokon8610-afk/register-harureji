// ==========================================
// ハイテク音声レジスター - 画像管理システム（Google Drive方式）
// ==========================================
// ロゴ・お会計完了画像を Google Drive にアップロード・管理する。
//
// 【2026-08 変更】
// 以前は Firebase Cloud Storage を使っており、アップロードには
// 「店舗パスフレーズ」の設定が必須だった。しかしそのパスフレーズを
// 設定する画面（店舗ID・設定）が別の変更で削除されてしまい、
// 「パスフレーズの設定が必要です」というメッセージだけが出て
// 設定する場所がどこにも無い、という詰んだ状態になっていた。
//
// そこで、すでに google-drive-backup.js で実装済みの
// Google Drive連携（店長のGoogleアカウントに一度だけ許可してもらう方式）を
// そのまま流用する方式に変更した。これにより：
//   ・パスフレーズや店舗IDの概念が丸ごと不要になった
//     （Google Driveのアカウントごとに自動的にデータが分離されるため）
//   ・データバックアップと同じ1つの連携（📗 Google Driveと連携）で完結する
//
// 画像ファイルは、連携したGoogleアカウントのマイドライブ直下に
// 固定ファイル名（haru-pos-logo.png / haru-pos-checkout-image.png）で
// 保存され、アップロードのたびに上書きされる。他端末（レジ・客用ディスプレイ・
// スマホ）で表示するため、「リンクを知っている全員が閲覧可」に設定して
// 画像への直接リンクURLを他の端末でもそのまま<img>表示できるようにしている。
//
// google-drive-backup.js は直接編集せず、そちらが用意している
// ensureGoogleDriveToken() / gDriveApiFetch() をそのまま呼び出す。
// ==========================================

const GDRIVE_LOGO_FILENAME = 'haru-pos-logo.png';
const GDRIVE_CHECKOUT_IMAGE_FILENAME = 'haru-pos-checkout-image.png';

// 指定した名前のファイルをGoogle Drive上（このアプリが作成したファイルの中）から検索する
async function findGoogleDriveFileIdByName(filename) {
    const q = encodeURIComponent(`name = '${filename}' and trashed = false`);
    const res = await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`);
    if (!res.ok) throw new Error(`Drive検索エラー: ${res.status}`);
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0].id;
    return null;
}

// ファイルを「リンクを知っている全員が閲覧可」に設定する
// （他端末の<img>タグで、ログインなしに直接表示できるようにするため）
async function makeGoogleDriveFilePublic(fileId) {
    try {
        await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'reader', type: 'anyone' })
        });
    } catch (err) {
        console.warn('Google Drive公開設定エラー:', err);
    }
}

function getGoogleDriveImageViewUrl(fileId) {
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

// ファイルをArrayBuffer→Base64文字列に変換する（Drive APIのmultipartアップロード用）
async function fileToBase64(file) {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/**
 * 画像ファイルをGoogle Driveへアップロード（新規作成 or 上書き）し、公開URLを返す
 * @param {File} file - アップロードするファイル
 * @param {string} filename - Drive上で使う固定ファイル名
 * @returns {Promise<{fileId: string, url: string}|null>}
 */
async function uploadImageToGoogleDrive(file, filename) {
    // 写真を選んだ＝明示的な操作なので、必要ならアカウント選択・同意画面を出してよい
    const ok = await ensureGoogleDriveToken(true);
    if (!ok) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'Google Driveとの連携が必要です。「データ管理」の「📗 Google Driveと連携」を先に行ってください。',
                'Google Drive と の れんけい が ひつよう です。',
                () => {}, true
            );
        }
        return null;
    }

    try {
        const fileId = await findGoogleDriveFileIdByName(filename);
        const mimeType = file.type || 'image/png';
        const metadata = { name: filename, mimeType: mimeType };
        const base64Data = await fileToBase64(file);

        const boundary = 'haru_pos_img_boundary_' + Date.now();
        const multipartBody =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Data}\r\n` +
            `--${boundary}--`;

        const uploadUrl = fileId
            ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
            : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

        const res = await gDriveApiFetch(uploadUrl, {
            method: fileId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: multipartBody
        });

        if (!res.ok) throw new Error(`Driveアップロードエラー: ${res.status}`);
        const created = await res.json();
        const newFileId = created.id || fileId;

        await makeGoogleDriveFilePublic(newFileId);

        return { fileId: newFileId, url: getGoogleDriveImageViewUrl(newFileId) };
    } catch (error) {
        console.error('Google Driveへの画像アップロードに失敗しました:', error);
        return null;
    }
}

// 指定した名前のファイルをGoogle Driveから削除する
async function deleteGoogleDriveFileByName(filename, interactive) {
    try {
        const ok = await ensureGoogleDriveToken(!!interactive);
        if (!ok) return;
        const fileId = await findGoogleDriveFileIdByName(filename);
        if (!fileId) return;
        await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
        console.log(`✅ Google Driveから削除完了: ${filename}`);
    } catch (err) {
        console.warn('Google Drive画像削除エラー:', err);
    }
}

/**
 * ロゴをローカル/Google Drive両方に保存（既存UI用。イベントハンドラ名は変更なし）
 * @param {Event} event - input[type="file"]の change イベント
 */
async function uploadShopLogo(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof playSound === 'function') playSound('click');

    // まずローカル保存（即座にプレビュー表示できるようにする。ネット環境に関わらず動く）
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

        // Google Driveへのアップロード（連携済みなら他端末にも反映される）
        const result = await uploadImageToGoogleDrive(file, GDRIVE_LOGO_FILENAME);
        if (result) {
            setShopLogoUrl(result.url);
            localStorage.setItem('pos_shop_logo_url_cloud', result.url);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            console.log('✅ ロゴをGoogle Driveに保存完了:', result.url);
        }
    };
    reader.readAsDataURL(file);

    // イベントリセット
    event.target.value = '';
}

/**
 * ロゴをクリア（ローカルとGoogle Drive両方）
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

                // Google Driveからも削除（連携している場合のみ。明示的な操作なので画面表示OK）
                await deleteGoogleDriveFileByName(GDRIVE_LOGO_FILENAME, true);

                if (typeof playSound === 'function') playSound('success');
                if (typeof speak === 'function') speak('ろご を さくじょ しました');
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            },
            true
        );
    }
}

/**
 * お会計完了画像をローカル/Google Drive両方に保存
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

        // Google Driveへのアップロード
        const result = await uploadImageToGoogleDrive(file, GDRIVE_CHECKOUT_IMAGE_FILENAME);
        if (result) {
            setShopCheckoutImageUrl(result.url);
            localStorage.setItem('pos_shop_checkout_image_url_cloud', result.url);
            if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            console.log('✅ お会計完了画像をGoogle Driveに保存完了:', result.url);
        }
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

                await deleteGoogleDriveFileByName(GDRIVE_CHECKOUT_IMAGE_FILENAME, true);

                if (typeof playSound === 'function') playSound('success');
                if (typeof speak === 'function') speak('かんりょう がぞう を さくじょ しました');
                if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
            },
            true
        );
    }
}

/**
 * Google Driveからロゴを取得して表示する（自動実行。画面は一切出さない）
 */
async function loadShopLogoFromCloud() {
    try {
        // 自動実行（ページ読み込み時）なので、画面（アカウント選択等）は絶対に出さない。
        // 連携済みで、かつトークンがすぐに使える場合だけ実行する。
        const ok = await ensureGoogleDriveToken(false);
        if (!ok) return null;

        const fileId = await findGoogleDriveFileIdByName(GDRIVE_LOGO_FILENAME);
        if (!fileId) return null;

        const url = getGoogleDriveImageViewUrl(fileId);
        setShopLogoUrl(url);
        localStorage.setItem('pos_shop_logo_url_cloud', url);

        const logoImg = document.getElementById('home-shop-logo');
        const receiptLogo = document.getElementById('receipt-preview-logo');
        if (logoImg) logoImg.src = url;
        if (receiptLogo) receiptLogo.src = url;

        console.log('✅ ロゴをGoogle Driveから読み込み:', url);
        return url;
    } catch (error) {
        console.warn('Google Driveロゴ読み込みエラー:', error);
    }
    return null;
}

/**
 * Google Driveからお会計完了画像を取得して表示する（自動実行。画面は一切出さない）
 */
async function loadCheckoutImageFromCloud() {
    try {
        const ok = await ensureGoogleDriveToken(false);
        if (!ok) return null;

        const fileId = await findGoogleDriveFileIdByName(GDRIVE_CHECKOUT_IMAGE_FILENAME);
        if (!fileId) return null;

        const url = getGoogleDriveImageViewUrl(fileId);
        setShopCheckoutImageUrl(url);
        localStorage.setItem('pos_shop_checkout_image_url_cloud', url);

        const previewImg = document.getElementById('checkout-image-preview');
        if (previewImg) {
            previewImg.src = url;
            previewImg.style.display = 'block';
        }

        console.log('✅ お会計完了画像をGoogle Driveから読み込み:', url);
        return url;
    } catch (error) {
        console.warn('Google Drive画像読み込みエラー:', error);
    }
    return null;
}

/**
 * ローカルからGoogle Driveへ一括アップロード
 * （バックアップからの復元時などに使用）
 */
async function syncImagesToCloud() {
    try {
        const logoLocal = localStorage.getItem('pos_shop_logo_local');
        const checkoutLocal = localStorage.getItem('pos_shop_checkout_image_local');

        if (logoLocal) {
            const blob = await (await fetch(logoLocal)).blob();
            const file = new File([blob], GDRIVE_LOGO_FILENAME, { type: blob.type || 'image/png' });
            await uploadImageToGoogleDrive(file, GDRIVE_LOGO_FILENAME);
        }

        if (checkoutLocal) {
            const blob = await (await fetch(checkoutLocal)).blob();
            const file = new File([blob], GDRIVE_CHECKOUT_IMAGE_FILENAME, { type: blob.type || 'image/png' });
            await uploadImageToGoogleDrive(file, GDRIVE_CHECKOUT_IMAGE_FILENAME);
        }

        console.log('✅ ローカル画像をGoogle Driveに同期完了');
    } catch (error) {
        console.warn('画像同期エラー:', error);
    }
}

/**
 * 初期化: アプリ起動時に画像を読み込む
 */
async function initImageStorage() {
    // 1. ローカルから先に読み込む（高速・オフラインでも動く）
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

    // 2. Google Driveと連携済みの場合のみ、最新版を非同期でフェッチ（バックグラウンド・無音）
    setTimeout(async () => {
        if (localStorage.getItem('pos_gdrive_connected') === 'true') {
            await loadShopLogoFromCloud();
            await loadCheckoutImageFromCloud();
        }
    }, 2000);
}

// DOMContentLoaded時に初期化
document.addEventListener('DOMContentLoaded', () => {
    // ロゴ・画像の読み込み
    setTimeout(initImageStorage, 500);
});
