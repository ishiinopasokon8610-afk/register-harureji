// ==========================================
// firebase-cloud-backup.js
// データのクラウド自動バックアップ（Firestore）
// ------------------------------------------
// local-backup.js が「①ダウンロード保存 ②レシート保存フォルダへの自動保存」を
// 用意しているのと同じ考え方で、③としてクラウド（Firestore）にも
// 自動でバックアップを送るようにする。
//
// 【メリット】
// ・端末の故障・紛失、ブラウザの「サイトデータを削除」操作などで
//   ローカルのデータ（localStorage / IndexedDB / 保存フォルダ）が
//   すべて失われた場合でも、クラウド側にコピーが残っている
// ・別のパソコン・別の場所からでも、最後のバックアップを取り出せる
//
// 【対象外にしているもの】
// お会計完了画像・お店のロゴ画像（base64の大きい画像データ）は、
// Firestoreの1ドキュメントあたり1MBという上限に引っかかりやすいため、
// クラウドバックアップの対象からは外している
// （今まで通り、ローカル/ファイルバックアップ側でカバーされる）。
//
// auth-system.js / local-backup.js は直接編集せず、
// 既存の window.haruPosBackupNow をラップして相乗りする。
// ==========================================

const CLOUD_BACKUP_LATEST_DOC_ID = 'latest'; // 「データが消えた時の復元用」の、店舗内共通・保険ドキュメント

// ------------------------------------------------------------
// セキュリティ強化（店舗ごとの分離）
// ------------------------------------------------------------
// 以前はすべての店舗が同じ「pos_cloud_backup」コレクションを共有しており、
// Firestoreにサインインしていれば（匿名サインインも含め）誰でも
// 他店舗のバックアップ（顧客データ・売上履歴など）を読み書きできてしまっていた。
// 特に固定ID「latest」は、店舗を問わず必ず存在する共通の保険ドキュメントだったため、
// 店舗IDを知らなくても中身を読まれてしまう状態だった。
//
// これを、店舗ID(shopId)ごとの領域 shops/{shopId}/backups/{docId} に分離し、
// firestore.rules 側で「対応する店舗の合言葉ハッシュ(pwHash)が一致する
// 書き込みのみ許可」するように変更した。shop-id-system.js が
// 合言葉のハッシュをあらかじめ shops/{shopId}/config/auth に登録する。
function getCloudBackupCollectionRef() {
    if (typeof getOrCreateShopId !== 'function') return null;
    const shopId = getOrCreateShopId();
    return firebase.firestore().collection('shops').doc(shopId).collection('backups');
}

// 複数端末で使う場合に備え、端末ごとに別ドキュメントへバックアップする。
// 一度発行したIDはこの端末のlocalStorageにずっと保存され、再起動しても変わらない
// （毎回変わるPOS_DEVICE_ID [state.js] とは別物。バックアップ先を安定させるためだけに使う）。
// これにより、複数台のレジが同時にクラウドバックアップを書き込んでも、
// お互いのデータを上書きし合うことがなくなる。
function getCloudBackupDocId() {
    let id = null;
    try { id = localStorage.getItem('pos_cloud_backup_device_id'); } catch (e) {}
    if (!id) {
        id = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        try { localStorage.setItem('pos_cloud_backup_device_id', id); } catch (e) {}
    }
    return id;
}

function isFirestoreReady() {
    return typeof firebase !== 'undefined' && typeof firebase.firestore === 'function';
}

// クラウドバックアップまわりで最後に起きたエラーを保持しておく。
// 自動処理（数分おきの定期バックアップ等）では毎回ポップアップを出すとうるさいため、
// ここに記録するだけにとどめ、実際にユーザーへ見せるのは
// testCloudBackupConnection()（手動の「クラウド接続テスト」ボタン）から。
let haruPosCloudBackupLastError = null;

// Firebaseのエラーコードを、店舗の人が読んで対処できる日本語メッセージに変換する
function describeCloudBackupError(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
        return '【原因】Firebase Consoleで「匿名（Anonymous）」ログインが有効になっていません。\n\n【対処】Firebase Console → Authentication → Sign-in method（ログイン方法）→「匿名」を選択して有効にしてください。';
    }
    if (code === 'permission-denied') {
        return '【原因】Firestoreのセキュリティルールが正しく公開されていないか、店舗の「合言葉」がまだ設定・同期されていない可能性があります（サインインはできています）。\n\n【対処】① Firebase Console → Firestore Database → ルール タブで、firestore.rulesの内容が反映・公開されているか確認してください。\n② ホーム画面の「データ管理・ロゴ設定」→ 店舗ID・設定 で、合言葉を入力して保存し直してください。';
    }
    if (code === 'unavailable' || code === 'network-request-failed') {
        return '【原因】通信エラーです。インターネット接続をご確認のうえ、しばらくしてからもう一度お試しください。';
    }
    if (code === 'not-found' || code === 'failed-precondition') {
        return '【原因】このFirebaseプロジェクトにFirestoreデータベースがまだ作成されていない可能性があります。\n\n【対処】Firebase Console → Firestore Database →「データベースの作成」を行ってください（Datastoreモードではなく、ネイティブモードを選択）。';
    }
    return `【原因】${code || 'unknown'} : ${(err && err.message) || err}`;
}

// バックアップ・復元のためだけに、この端末を匿名でFirebaseにサインインさせる。
// （店長ログインとは別物。ユーザーには見えないし、店長かどうかの権限には影響しない）
// 失敗時は一定間隔でリトライする（ただし「機能自体が無効」なエラーはリトライしても直らないため止める）。
let anonymousAuthRetryTimer = null;
function ensureAnonymousAuthForBackup() {
    if (!isFirestoreReady() || typeof firebase.auth !== 'function') return;
    if (firebase.auth().currentUser) {
        haruPosCloudBackupLastError = null;
        return; // すでに何らかの形でサインイン済み（店長ログイン中含む）
    }
    firebase.auth().signInAnonymously().then(() => {
        haruPosCloudBackupLastError = null;
        if (anonymousAuthRetryTimer) { clearTimeout(anonymousAuthRetryTimer); anonymousAuthRetryTimer = null; }
    }).catch((err) => {
        console.warn('クラウドバックアップ用の匿名サインインに失敗しました:', err);
        haruPosCloudBackupLastError = err;
        // 「無効化されている」系のエラーはリトライしても直らないので止める
        const permanent = err && (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation');
        if (!permanent && !anonymousAuthRetryTimer) {
            anonymousAuthRetryTimer = setTimeout(() => {
                anonymousAuthRetryTimer = null;
                ensureAnonymousAuthForBackup();
            }, 30 * 1000);
        }
    });
}

// 手動：「☁️ クラウド接続テスト」ボタンから呼び出す。
// 実際にサインイン→書き込み→読み込みまで行い、結果をはっきり画面に表示する。
// これまでは失敗してもconsole.warnにしか出ず気づけなかったため、これで原因が分かるようにする。
async function testCloudBackupConnection() {
    if (typeof playSound === 'function') playSound('click');

    if (!isFirestoreReady()) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                "Firebase/Firestoreのスクリプトが読み込まれていません。index.htmlのFirebase関連scriptタグと、通信環境をご確認ください。",
                "くらうど せつぞく てすと に しっぱい し まし た。",
                () => {}, false
            );
        }
        return;
    }

    try {
        // サインインしていなければ試みる（ここでは待つ）
        if (!firebase.auth().currentUser) {
            await firebase.auth().signInAnonymously();
        }

        const passphrase = (typeof getShopPassphrase === 'function') ? getShopPassphrase() : '';
        if (!passphrase) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    "店舗の「合言葉」がまだ設定されていません。クラウドバックアップを使う前に、データ管理・ロゴ設定 → 店舗ID・設定 から合言葉を保存してください。",
                    "あいことば が まだ せってい さ れ て い ませ ん。",
                    () => {}, false
                );
            }
            return;
        }
        // 合言葉がFirestore側にまだ登録されていなければ、先に登録しておく
        if (typeof syncShopPassphraseToFirestore === 'function') {
            await syncShopPassphraseToFirestore(passphrase);
        }
        const pwHash = (typeof hashShopPassphrase === 'function') ? await hashShopPassphrase(passphrase) : null;

        const collectionRef = getCloudBackupCollectionRef();
        if (!collectionRef) throw new Error('店舗IDシステム(shop-id-system.js)が読み込まれていません');

        const testRef = collectionRef.doc(getCloudBackupDocId());
        await testRef.set({ connectionTestAt: new Date().toISOString(), pwHash: pwHash }, { merge: true });
        const snap = await testRef.get();

        if (snap.exists) {
            haruPosCloudBackupLastError = null;
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    "✅ クラウド接続は正常です。サインイン・書き込み・読み込みすべて成功しました。今後は自動的にバックアップされます。",
                    "くらうど せつぞく てすと に せいこう し まし た。",
                    () => { writeCloudBackupIfAvailable(); }, false
                );
            }
        } else {
            throw new Error('書き込み後にドキュメントが確認できませんでした');
        }
    } catch (err) {
        console.warn('クラウド接続テストに失敗しました:', err);
        haruPosCloudBackupLastError = err;
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                "❌ クラウド接続テストに失敗しました。\n\n" + describeCloudBackupError(err),
                "くらうど せつぞく てすと に しっぱい し まし た。",
                () => {}, false
            );
        }
    }
}

// 画像など重い/対象外のフィールドを除いた、バックアップ用オブジェクトを作る
function buildCloudBackupObject() {
    if (typeof buildAllDataObject !== 'function') return null;
    const dataObj = buildAllDataObject();
    const { checkoutCompleteImage, shopLogo, ...rest } = dataObj;
    return rest;
}

async function writeCloudBackupIfAvailable() {
    if (!isFirestoreReady()) return;
    if (!firebase.auth().currentUser) return; // サインインが終わるまでは書き込まない

    const passphrase = (typeof getShopPassphrase === 'function') ? getShopPassphrase() : '';
    if (!passphrase) return; // 合言葉未設定の店舗はクラウドバックアップを行わない（firestore.rulesでも拒否される）

    const collectionRef = getCloudBackupCollectionRef();
    if (!collectionRef) return;

    const backupObj = buildCloudBackupObject();
    if (!backupObj) return;

    const pwHash = (typeof hashShopPassphrase === 'function') ? await hashShopPassphrase(passphrase) : null;
    if (!pwHash) return;
    backupObj.pwHash = pwHash; // firestore.rulesがこのフィールドを合言葉ハッシュと照合する

    // ローカルにまだ実データが無い（＝キャッシュ削除直後などで空の可能性がある）場合、
    // 店舗内共通の復元用ドキュメント（latest）をその空データで上書きしてしまうと、
    // 他の端末や過去の自分自身が積み上げた「本物のバックアップ」が消えてしまう。
    // そのため latest への書き込みは、実データがある場合のみに限定する。
    // （端末ごとの個別ドキュメントへの保存は、空でも害がないのでそのまま行う）
    const hasRealData =
        (Array.isArray(backupObj.products) && backupObj.products.length > 0) ||
        (Array.isArray(backupObj.clerks) && backupObj.clerks.length > 1); // 初期値は店長1人だけなので1件は「空」扱い

    try {
        await collectionRef.doc(getCloudBackupDocId()).set(backupObj);

        // 「データが消えた時に復元できる場所」を常に最新に保つための、店舗内共通ドキュメント。
        // 端末ごとのIDはlocalStorageと一緒に消えてしまうため、
        // 復元チェックはこちら（固定ID）だけを見るようにする。
        if (hasRealData) {
            await collectionRef.doc(CLOUD_BACKUP_LATEST_DOC_ID).set(backupObj);
        }
    } catch (err) {
        // 1MB上限超過（商品数・履歴が非常に多い場合など）やネットワークエラーは
        // 毎回表示すると邪魔になるため、コンソールへの警告のみに留める
        // （最新のエラーは haruPosCloudBackupLastError に記録し、
        //   「☁️ クラウド接続テスト」ボタンを押した時にすぐ原因を確認できるようにする）
        console.warn('クラウドバックアップの書き込みに失敗しました:', err);
        haruPosCloudBackupLastError = err;
    }
}

// 起動時：ローカルにデータがほぼ無い（＝消えた直後の可能性がある）場合、
// クラウド側にバックアップが残っていれば復元するか確認する
async function checkCloudBackupForRestoreOnStartup() {
    const hasExistingData = (localStorage.getItem('pos_products') && localStorage.getItem('pos_products') !== '[]') ||
        (localStorage.getItem('pos_clerks') && localStorage.getItem('pos_clerks') !== '[]');
    if (hasExistingData) return;

    // IndexedDB・ローカルフォルダからの復元が先に走る可能性があるため、少し待ってから確認する
    await new Promise(resolve => setTimeout(resolve, 2500));
    if (localStorage.getItem('pos_products')) return; // 待っている間に他の方法で復元された

    if (!isFirestoreReady()) return;

    try {
        const collectionRef = getCloudBackupCollectionRef();
        if (!collectionRef) return;
        const snap = await collectionRef.doc(CLOUD_BACKUP_LATEST_DOC_ID).get();

        if (!snap.exists) return;
        const dataObj = snap.data();
        const savedAtLabel = dataObj.savedAt ? new Date(dataObj.savedAt).toLocaleString('ja-JP') : '不明';

        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `データが見つからないため確認します。クラウドに保存日時「${savedAtLabel}」のバックアップがあります。これで復元しますか？（お会計完了画像・ロゴ画像はクラウドバックアップの対象外のため復元されません）`,
                "くらうど に ばっくあっぷ が みつかり まし た。 ふっきゅう し ます か？",
                (res) => {
                    if (res && typeof applyImportedDataObject === 'function') applyImportedDataObject(dataObj);
                },
                true
            );
        }
    } catch (err) {
        console.warn('クラウドバックアップの確認に失敗しました:', err);
    }
}

// 手動：「クラウドから復元する」ボタンから呼び出す。
// 起動時チェック（checkCloudBackupForRestoreOnStartup）と違い、
// ローカルにすでにデータがあっても、いつでも押して復元できる。
async function restoreFromCloudBackupManual() {
    if (typeof playSound === 'function') playSound('click');

    if (!isFirestoreReady()) {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("クラウドバックアップの機能が読み込まれていません。", "くらうど が つかえ ませ ん。", () => {}, false);
        }
        return;
    }

    try {
        const collectionRef = getCloudBackupCollectionRef();
        if (!collectionRef) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("店舗IDシステムが読み込まれていません。", "しょっぷあいでぃー が つかえ ませ ん。", () => {}, false);
            }
            return;
        }
        const snap = await collectionRef.doc(CLOUD_BACKUP_LATEST_DOC_ID).get();

        if (!snap.exists) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("クラウド上にバックアップが見つかりませんでした。", "ばっくあっぷ が みつかり ませ ん。", () => {}, false);
            }
            return;
        }

        const dataObj = snap.data();
        const savedAtLabel = dataObj.savedAt ? new Date(dataObj.savedAt).toLocaleString('ja-JP') : '不明';

        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `クラウドに保存日時「${savedAtLabel}」のバックアップがあります。今のデータを上書きして復元しますか？（お会計完了画像・ロゴ画像は対象外のため復元されません）`,
                "くらうど から ふっきゅう し ます。 よろしい です か？",
                (res) => {
                    if (res && typeof applyImportedDataObject === 'function') applyImportedDataObject(dataObj);
                },
                true
            );
        }
    } catch (err) {
        console.warn('クラウドからの手動復元に失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("クラウドからの復元に失敗しました。通信状況を確認してください。", "ふっきゅう に しっぱい し まし た。", () => {}, false);
        }
    }
}

/* =========================================================
   フック：既存の window.haruPosBackupNow に相乗りし、
   同じタイミングでクラウドへの書き出しも行う
   ========================================================= */
(function hookCloudBackupIntoExistingBackup() {
    function tryHook() {
        if (typeof window.haruPosBackupNow !== 'function' || !isFirestoreReady()) {
            setTimeout(tryHook, 500);
            return;
        }
        const originalBackupNow = window.haruPosBackupNow;
        window.haruPosBackupNow = function (...args) {
            const result = originalBackupNow.apply(this, args);
            writeCloudBackupIfAvailable();
            return result;
        };

        ensureAnonymousAuthForBackup();

        // サインイン完了を待ってから、起動直後のバックアップ・復元チェックを行う。
        // 重要：必ず「復元チェックが先・書き込みは後」の順で行う。
        // 逆順（先に書き込み）だと、ローカルデータが空の端末が起動した瞬間に
        // 空のデータで共通バックアップ（latest）を上書きしてしまい、
        // その直後の復元チェックが「自分がたった今上書きした空データ」を
        // 読み込むだけになってしまう。
        firebase.auth().onAuthStateChanged(async (user) => {
            if (!user) return;
            await checkCloudBackupForRestoreOnStartup();
            writeCloudBackupIfAvailable();
        });
    }
    tryHook();
})();

// 数分に1回、念のためクラウドへも自動バックアップする（5分ごと）
setInterval(() => { writeCloudBackupIfAvailable(); }, 5 * 60 * 1000);

// タブを閉じる・隠す（別アプリに切り替える、画面を消すなど）タイミングでも
// 念のため最後にもう一度クラウドへバックアップしておく
window.addEventListener('pagehide', () => { writeCloudBackupIfAvailable(); });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') writeCloudBackupIfAvailable();
});
