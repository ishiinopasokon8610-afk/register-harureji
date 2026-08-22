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
 * 合言葉をSHA-256でハッシュ化する（16進数文字列で返す）。
 * 合言葉そのものはFirestoreに保存せず、このハッシュだけを送信・保存する。
 */
async function hashShopPassphrase(passphrase) {
    const enc = new TextEncoder().encode(passphrase || '');
    const digest = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 現在の合言葉ハッシュをFirestoreの shops/{shopId}/config/auth に登録・更新する。
 * firestore.rules 側で、書き込み（クラウドバックアップ）はこのハッシュと
 * 一致した場合のみ許可されるようになっている。
 * @param {string} oldPassphrase - 既に合言葉が登録済みの場合、変更のために必要な「現在の」合言葉
 */
async function syncShopPassphraseToFirestore(oldPassphrase) {
    if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') return false;
    if (!firebase.auth().currentUser) {
        try { await firebase.auth().signInAnonymously(); } catch (e) { console.warn('合言葉の同期に失敗しました（未サインイン）:', e); return false; }
    }

    const shopId = getOrCreateShopId();
    const passphrase = getShopPassphrase();
    if (!passphrase) return false;

    const newHash = await hashShopPassphrase(passphrase);
    const docRef = firebase.firestore().collection('shops').doc(shopId).collection('config').doc('auth');

    try {
        const snap = await docRef.get();
        if (!snap.exists) {
            // 初回登録
            await docRef.set({ passphraseHash: newHash, createdAt: Date.now() });
        } else {
            // 既存の合言葉から変更する場合：現在の合言葉ハッシュを証明として一緒に送る
            const oldHash = await hashShopPassphrase(oldPassphrase !== undefined ? oldPassphrase : passphrase);
            await docRef.update({ passphraseHash: newHash, oldPassphraseHash: oldHash, updatedAt: Date.now() });
        }

        // 【復元用索引】合言葉ハッシュ → 店舗ID の対応を別コレクションに記録しておく。
        // キャッシュ削除等で端末から店舗ID（localStorage）だけが失われた場合でも、
        // 合言葉さえ分かれば restoreShopIdFromPassphrase() でこの索引を引いて
        // 同じ店舗IDに戻れるようにするため。店舗IDそのものは変更しない（既存データは無傷）。
        try {
            await firebase.firestore().collection('shop_passphrase_lookup').doc(newHash).set(
                { shopId: shopId, updatedAt: Date.now() },
                { merge: true }
            );
        } catch (lookupErr) {
            console.warn('店舗ID復元用の索引登録に失敗しました（バックアップ本体には影響ありません）:', lookupErr);
        }

        return true;
    } catch (err) {
        console.warn('合言葉のクラウド同期に失敗しました（オンライン時に自動で再試行されます）:', err);
        return false;
    }
}

/**
 * 【方針A: 合言葉からの自動復元】
 * キャッシュ削除等で店舗ID（localStorageの pos_shop_id）が失われた端末で、
 * 合言葉を入力してもらい、shop_passphrase_lookup 索引から元の店舗IDを探し出して復元する。
 * @param {string} passphrase - 以前この店舗で設定していた合言葉
 * @returns {Promise<boolean>} 復元できたか
 */
async function restoreShopIdFromPassphrase(passphrase) {
    if (!passphrase || passphrase.trim() === '') return false;
    if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') return false;

    if (!firebase.auth().currentUser) {
        try { await firebase.auth().signInAnonymously(); } catch (e) {
            console.warn('店舗ID復元用のサインインに失敗しました:', e);
            return false;
        }
    }

    try {
        const hash = await hashShopPassphrase(passphrase.trim());
        const snap = await firebase.firestore().collection('shop_passphrase_lookup').doc(hash).get();
        if (!snap.exists) return false;

        const data = snap.data();
        if (!data || !data.shopId) return false;

        setShopId(data.shopId);
        setShopPassphrase(passphrase.trim());
        return true;
    } catch (err) {
        console.warn('合言葉からの店舗ID復元に失敗しました:', err);
        return false;
    }
}

/**
 * 【方針B: 手入力での復元（保険）】
 * 事前にコピーしておいた店舗IDを直接貼り付けて復元する。
 * 合言葉を覚えていない・索引がまだ無い古いデータのケースの保険。
 * @param {string} shopId
 */
function setShopId(shopId) {
    if (!shopId || shopId.trim() === '') return false;
    localStorage.setItem(SHOP_ID_KEY, shopId.trim());
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

            <hr style="margin: 16px 0; border: none; border-top: 1px solid #c5cae9;">

            <div style="margin-bottom: 12px;">
                <h4 style="color: #1a237e; margin: 0 0 6px 0;">🔁 店舗IDの復元（キャッシュ削除等でデータが見つからない時）</h4>

                <p style="font-size: 12px; color: #555; margin: 0 0 6px 0;">
                    ① 以前この店舗で使っていた「合言葉」を入力して復元:
                </p>
                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
                    <input type="password" id="shop-restore-passphrase-input" placeholder="以前の合言葉" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    <button onclick="restoreShopIdFromPassphraseUI()" style="flex: 0; padding: 8px 12px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; white-space: nowrap;">合言葉で復元</button>
                </div>

                <p style="font-size: 12px; color: #555; margin: 0 0 6px 0;">
                    ② 合言葉が分からない場合は、事前にコピーしておいた店舗IDを直接貼り付け:
                </p>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="shop-restore-id-input" placeholder="shop_xxxxx_xxxxx_x" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 12px;">
                    <button onclick="restoreShopIdManualUI()" style="flex: 0; padding: 8px 12px; background: #607d8b; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; white-space: nowrap;">IDで復元</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 「合言葉で復元」ボタンのハンドラ
 */
async function restoreShopIdFromPassphraseUI() {
    const input = document.getElementById('shop-restore-passphrase-input');
    const passphrase = input ? input.value.trim() : '';
    if (!passphrase) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    const ok = await restoreShopIdFromPassphrase(passphrase);
    if (ok) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                '店舗IDを復元しました。ページを再読み込みしてデータを取得します。',
                'てんぽ を ふっきゅう し まし た',
                () => { location.reload(); },
                false
            );
        } else {
            location.reload();
        }
    } else {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                'この合言葉に一致する店舗が見つかりませんでした。合言葉が違うか、この合言葉ではまだ一度もクラウド保存を行ったことがない可能性があります。',
                'みつかり ませ ん でし た',
                () => {},
                false
            );
        }
    }
}

/**
 * 「IDで復元」ボタンのハンドラ
 */
function restoreShopIdManualUI() {
    const input = document.getElementById('shop-restore-id-input');
    const shopId = input ? input.value.trim() : '';
    if (!shopId) {
        if (typeof playSound === 'function') playSound('error');
        return;
    }

    if (typeof showCustomConfirm === 'function') {
        showCustomConfirm(
            `店舗IDを「${shopId}」に設定し直します。よろしいですか？（ページが再読み込みされます）`,
            'てんぽあいでぃー を せってい し なおし ます',
            (res) => {
                if (!res) return;
                setShopId(shopId);
                location.reload();
            },
            true
        );
    } else {
        setShopId(shopId);
        location.reload();
    }
}

function togglePassphraseVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = (input.type === 'password') ? 'text' : 'password';
}

async function saveShopPassphrase() {
    const input = document.getElementById('shop-passphrase-input');
    const passphrase = input ? input.value.trim() : '';
    if (!passphrase) {
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('パスフレーズを入力してください。', 'ぱすふれーず を にゅうりょく し て ください', () => {}, true);
        }
        return;
    }
    // クラウド側の検証（更新の場合の「証明」）には、上書きされる前の現在の合言葉が必要
    const previousPassphrase = getShopPassphrase();

    setShopPassphrase(passphrase);
    localStorage.setItem('pos_shop_passphrase', passphrase);

    const synced = await syncShopPassphraseToFirestore(previousPassphrase);
    if (!synced) {
        console.warn('合言葉はローカルには保存されましたが、クラウド側との同期は失敗しました。オンラインになった時に再度「保存」を押してください。');
    }

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

    // 既にローカルに合言葉が設定済みなのに、まだFirestore側に登録されていない
    // （＝このセキュリティ強化より前から使っていた店舗）場合に備え、
    // 起動時にも一度だけ同期を試みる（失敗しても静かに諦める。次回保存時に再試行される）。
    (function trySyncExistingPassphrase() {
        function attempt() {
            if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') {
                setTimeout(attempt, 1000);
                return;
            }
            const passphrase = getShopPassphrase();
            if (passphrase) {
                syncShopPassphraseToFirestore(passphrase).catch(() => {});
            }
        }
        setTimeout(attempt, 2000);
    })();
});
