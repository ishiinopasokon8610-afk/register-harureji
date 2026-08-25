// ==========================================
// google-drive-backup.js
// IndexedDB/localStorageのデータを Google Drive とも同期するバックアップ機能
// ------------------------------------------
// local-backup.js の「①ダウンロード保存 ②ローカルフォルダへの自動保存」、
// firebase-cloud-backup.js の「③Firestoreへの自動保存」と同じ考え方で、
// ④として Google Drive にも自動でバックアップを送れるようにする。
//
// 【使う仕組み】
// Google Identity Services（GIS）のトークンクライアントで、店長のGoogleアカウントに
// 「このアプリが作成したファイルだけ」を読み書きできる権限（drive.file スコープ）を
// 一度だけ許可してもらう。以後は、そのファイル（haru-pos-backup.json）だけを
// 上書き更新していく。ドライブ内の他のファイルには一切アクセスできない。
//
// 【事前準備（店長が1回だけ行う）】
// 1. https://console.cloud.google.com/ でプロジェクトを作成
// 2. 「APIとサービス」→「ライブラリ」で Google Drive API を有効化
// 3. 「APIとサービス」→「認証情報」→「OAuth クライアント ID」を作成
//    （アプリの種類：ウェブアプリケーション。承認済みのJavaScript生成元に、
//      このレジ画面を開くURL（例: https://example.com）を登録する）
// 4. 発行された「クライアントID」を、下の GOOGLE_DRIVE_CLIENT_ID に貼り付ける
//
// 【index.htmlに追加してほしいボタン（例）】
//   <button onclick="connectGoogleDrive()">📗 Google Driveと連携</button>
//   <button onclick="backupToGoogleDriveNow()">📤 今すぐDriveにバックアップ</button>
//   <button onclick="restoreFromGoogleDrive()">📥 Driveから復元</button>
//
// register.js / master-mgmt.js / auth-system.js / local-backup.js は直接編集せず、
// 既存の window.haruPosBackupNow をラップして相乗りする（他のバックアップ先と同じ方式）。
// ==========================================

// ↓↓↓ ここに、Google Cloud Consoleで発行した「OAuthクライアントID」を貼り付けてください ↓↓↓
const GOOGLE_DRIVE_CLIENT_ID = '698126390011-b1ucm6jm3iblrp8m0pueavnmrldj57q3.apps.googleusercontent.com';
// アプリが作成したファイルのみアクセスできる、最も限定的なスコープ
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_DRIVE_BACKUP_FILENAME = 'haru-pos-backup.json';

let gDriveTokenClient = null;
let gDriveAccessToken = null;
let gDriveAccessTokenExpiresAt = 0;
let gDriveFileId = null; // 一度見つけた/作成したバックアップファイルのIDをキャッシュ
let gDriveLastBackupSnapshot = null;

function isGoogleDriveConfigured() {
    return typeof GOOGLE_DRIVE_CLIENT_ID === 'string' &&
        GOOGLE_DRIVE_CLIENT_ID.indexOf('YOUR_CLIENT_ID') === -1 &&
        GOOGLE_DRIVE_CLIENT_ID.trim() !== '';
}

function isGoogleIdentityServicesReady() {
    return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
}

// Google Identity Servicesのスクリプトを一度だけ読み込む
let gisScriptLoading = null;
function loadGoogleIdentityServicesScript() {
    if (isGoogleIdentityServicesReady()) return Promise.resolve();
    if (gisScriptLoading) return gisScriptLoading;
    gisScriptLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Google Identity Servicesの読み込みに失敗しました'));
        document.head.appendChild(script);
    });
    return gisScriptLoading;
}

function hasValidGoogleDriveToken() {
    return !!gDriveAccessToken && Date.now() < gDriveAccessTokenExpiresAt - 60 * 1000;
}

/**
 * 店長がボタンを押した時に呼ぶ：Googleアカウントでの許可（同意画面）を出す
 * @param {boolean} interactive - true: ボタン押下など、人の操作による明示的な呼び出し
 *                                （必要ならアカウント選択・同意画面を表示してよい）
 *                                false: 5分おきの自動バックアップなど、裏側からの自動呼び出し
 *                                （画面は絶対に出さず、できなければ静かに諦める）
 */
async function connectGoogleDrive(interactive = true) {
    if (interactive && typeof playSound === 'function') playSound('click');

    if (!isGoogleDriveConfigured()) {
        if (interactive && typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                "Google Drive連携がまだ設定されていません。google-drive-backup.js内のGOOGLE_DRIVE_CLIENT_IDを設定してください。",
                "せってい が まだ です。",
                () => {}, false
            );
        }
        return;
    }

    try {
        await loadGoogleIdentityServicesScript();
    } catch (e) {
        console.warn(e);
        if (interactive && typeof showCustomConfirm === 'function') {
            showCustomConfirm("Google Driveへの接続準備に失敗しました。通信環境をご確認ください。", "せつぞく に しっぱい し まし た。", () => {}, false);
        }
        return;
    }

    if (!gDriveTokenClient) {
        gDriveTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_DRIVE_CLIENT_ID,
            scope: GOOGLE_DRIVE_SCOPE,
            callback: '' // requestAccessToken() の呼び出しごとに上書きする
        });
    }

    return new Promise((resolve) => {
        gDriveTokenClient.callback = (resp) => {
            if (resp && resp.access_token) {
                gDriveAccessToken = resp.access_token;
                gDriveAccessTokenExpiresAt = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000;
                localStorage.setItem('pos_gdrive_connected', 'true');
                if (interactive) {
                    if (typeof playSound === 'function') playSound('success');
                    if (typeof showCustomConfirm === 'function') {
                        showCustomConfirm("Google Driveとの連携が完了しました。以後、自動でバックアップされます。", "Google Drive と の れんけい が かんりょう し まし た。", () => {}, false);
                    }
                }
            } else {
                if (interactive && typeof playSound === 'function') playSound('error');
            }
            resolve(resp);
        };

        // 自動実行（interactive=false）でトークン取得に失敗した場合、ここに来ても
        // 画面には一切何も表示しない。次の自動実行、または店長が明示的に操作した時に
        // 改めて試みればよいだけなので、静かに諦める。
        gDriveTokenClient.error_callback = (err) => {
            if (interactive) {
                console.warn('Google Driveへの接続に失敗しました:', err);
            }
            resolve(null);
        };

        const alreadyConnected = localStorage.getItem('pos_gdrive_connected') === 'true';
        // 自動実行時は 'none'（画面を一切出さない。できなければ黙って失敗）を指定する。
        // 人の操作による場合のみ、必要に応じてアカウント選択・同意画面を出してよい。
        const promptValue = !interactive ? 'none' : (alreadyConnected ? '' : 'consent');
        gDriveTokenClient.requestAccessToken({ prompt: promptValue });
    });
}

// アクセストークンが切れていたら、可能な範囲で更新する
// @param {boolean} interactive - true: 人の操作による呼び出し（画面表示OK） / false: 自動実行（画面は出さない）
async function ensureGoogleDriveToken(interactive = false) {
    if (hasValidGoogleDriveToken()) return true;
    if (localStorage.getItem('pos_gdrive_connected') !== 'true') return false; // 未連携なら諦める

    // 自動実行（裏側からの定期バックアップ等）の場合、トークンがすでに切れているなら
    // ここで再認証は試みず、静かに諦める。
    // ------------------------------------------
    // 以前は自動実行時も connectGoogleDrive(false) → prompt:'none' で「画面を出さずに
    // 裏側だけで」トークンを更新しようとしていたが、環境（特にモバイルブラウザ）によっては
    // これが完全に隠れきらず、Googleの画面が一瞬表示されてしまうことがあった
    // （客用ディスプレイ端末でお客様に見えてしまうと特に問題になる）。
    // トークンの自動更新は「店長がボタンを押した時」「アプリを開き直してから最初に
    // 明示的な操作をした時」など、人の操作を伴うタイミングに限定する。
    if (!interactive) return false;

    try {
        await connectGoogleDrive(interactive);
        return hasValidGoogleDriveToken();
    } catch (e) {
        return false;
    }
}

async function gDriveApiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {}, {
        Authorization: `Bearer ${gDriveAccessToken}`
    });
    return fetch(url, Object.assign({}, options, { headers }));
}

// 既存のバックアップファイル（このアプリが作ったもの）を検索する
async function findGoogleDriveBackupFileId() {
    if (gDriveFileId) return gDriveFileId;
    const q = encodeURIComponent(`name = '${GOOGLE_DRIVE_BACKUP_FILENAME}' and trashed = false`);
    const res = await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)`);
    if (!res.ok) throw new Error(`Drive検索エラー: ${res.status}`);
    const data = await res.json();
    if (data.files && data.files.length > 0) {
        gDriveFileId = data.files[0].id;
        return gDriveFileId;
    }
    return null;
}

/**
 * 今のデータを Google Drive のバックアップファイルへ書き込む（新規作成 or 上書き更新）
 * silent: true の場合、成功時のポップアップを出さない（定期自動実行用）
 */
async function backupToGoogleDriveNow(silent = false) {
    if (!silent && typeof playSound === 'function') playSound('click');

    if (!isGoogleDriveConfigured()) {
        if (!silent) return connectGoogleDrive(true); // 未設定なら案内を出す（手動操作時のみ）
        return;
    }

    // silent=true（自動実行）の場合は interactive=false を渡し、画面を出さずに諦められるようにする
    const ok = await ensureGoogleDriveToken(!silent);
    if (!ok) {
        if (!silent) return connectGoogleDrive(true);
        return; // 自動実行時はここで静かに諦める（次回、トークンが有効な時か、店長が明示的に操作した時にまた送信される）
    }

    if (typeof buildAllDataObject !== 'function') {
        console.warn('buildAllDataObject が見つかりません（auth-system.jsの読み込み順を確認してください）');
        return;
    }

    try {
        const dataObj = buildAllDataObject();
        const jsonStr = JSON.stringify(dataObj);

        // 変化がなければ書き込まない（定期自動実行時のみ）
        if (silent && jsonStr === gDriveLastBackupSnapshot) return;

        const fileId = await findGoogleDriveBackupFileId();
        const metadata = { name: GOOGLE_DRIVE_BACKUP_FILENAME, mimeType: 'application/json' };
        if (!fileId) metadata.parents = undefined; // マイドライブ直下に作成（appDataFolder限定にしたい場合は 'appDataFolder' を指定）

        const boundary = 'haru_pos_boundary_' + Date.now();
        const multipartBody =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonStr}\r\n` +
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
        gDriveFileId = created.id || gDriveFileId;
        gDriveLastBackupSnapshot = jsonStr;

        if (!silent) {
            if (typeof playSound === 'function') playSound('success');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("Google Driveへのバックアップが完了しました。", "Google Drive へ の ばっくあっぷ が かんりょう し まし た。", () => {}, false);
            }
        }
    } catch (err) {
        console.warn('Google Driveへのバックアップに失敗しました:', err);
        if (!silent) {
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("Google Driveへのバックアップに失敗しました。連携をやり直してください。", "ばっくあっぷ に しっぱい し まし た。", () => {}, false);
            }
        }
    }
}

/**
 * Google Driveのバックアップファイルから復元する
 */
async function restoreFromGoogleDrive() {
    if (typeof playSound === 'function') playSound('click');

    // ボタンを押した明示的な操作なので、必要ならアカウント選択・同意画面を出してよい
    const ok = await ensureGoogleDriveToken(true);
    if (!ok) { await connectGoogleDrive(true); if (!hasValidGoogleDriveToken()) return; }

    try {
        const fileId = await findGoogleDriveBackupFileId();
        if (!fileId) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("Google Drive上にバックアップファイルが見つかりませんでした。", "ばっくあっぷ が みつかり ませ ん でし た。", () => {}, false);
            }
            return;
        }

        const res = await gDriveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
        if (!res.ok) throw new Error(`Drive取得エラー: ${res.status}`);
        const dataObj = await res.json();
        const savedAtLabel = dataObj.savedAt ? new Date(dataObj.savedAt).toLocaleString('ja-JP') : '不明';

        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `Google Driveのバックアップ（保存日時: ${savedAtLabel}）で現在のデータを上書きします。よろしいですか？`,
                "Google Drive の ばっくあっぷ から ふっきゅう し ます。 よろしい です か？",
                (res2) => {
                    if (!res2) return;
                    if (typeof applyImportedDataObject === 'function') applyImportedDataObject(dataObj);
                },
                true
            );
        }
    } catch (err) {
        console.warn('Google Driveからの復元に失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("Google Driveからの復元に失敗しました。", "ふっきゅう に しっぱい し まし た。", () => {}, false);
        }
    }
}

function disconnectGoogleDrive() {
    gDriveAccessToken = null;
    gDriveAccessTokenExpiresAt = 0;
    gDriveFileId = null;
    localStorage.removeItem('pos_gdrive_connected');
    if (isGoogleIdentityServicesReady() && gDriveAccessToken) {
        google.accounts.oauth2.revoke(gDriveAccessToken, () => {});
    }
    if (typeof playSound === 'function') playSound('click');
}

/* =========================================================
   フック：既存の window.haruPosBackupNow に相乗りし、
   同じタイミングでGoogle Driveへの書き出しも行う（連携済みの場合のみ・無音）
   ========================================================= */
(function hookGoogleDriveBackupIntoExistingBackup() {
    function tryHook() {
        if (typeof window.haruPosBackupNow !== 'function') {
            setTimeout(tryHook, 500);
            return;
        }
        const originalBackupNow = window.haruPosBackupNow;
        window.haruPosBackupNow = function (...args) {
            const result = originalBackupNow.apply(this, args);
            // 客用ディスプレイに指定されている端末は、そもそもバックアップの責任を持たせない
            // （お客様が見る画面なので、裏側の通信で何かが一瞬表示される余地自体を無くす）
            const isCustDisplay = typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
            if (!isCustDisplay && localStorage.getItem('pos_gdrive_connected') === 'true') {
                backupToGoogleDriveNow(true);
            }
            return result;
        };
    }
    tryHook();
})();

// 5分ごとに、連携済みなら自動でバックアップする（変化がない場合は書き込まない）
setInterval(() => {
    const isCustDisplay = typeof isCustomerDisplayDevice === 'function' && isCustomerDisplayDevice();
    if (!isCustDisplay && localStorage.getItem('pos_gdrive_connected') === 'true') {
        backupToGoogleDriveNow(true);
    }
}, 5 * 60 * 1000);
