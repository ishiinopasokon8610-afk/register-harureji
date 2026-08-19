// ==========================================
// local-backup.js - ブラウザのキャッシュ/Cookie削除に負けないデータ保護
// ------------------------------------------
// 前提として知っておいてほしいこと：
//   ブラウザの「Cookieとサイトデータを削除」を選ぶと、localStorageだけでなく
//   IndexedDB（従来のバックアップ先）も一緒に消えてしまう。これはブラウザが
//   意図的にそうなるよう作られているため、JavaScriptだけでは回避できない。
//   （HTMLファイルを再アップロード／再デプロイしただけではデータは消えない。
//     消えるのはあくまで「ブラウザ側でサイトデータを削除する操作をしたとき」）
//
//   本当の意味で消えないようにする唯一の方法は、ブラウザの中ではなく
//   「実際のファイルとしてパソコン（ローカル）に保存」しておくこと。
//   このファイルはその仕組みを2通り用意する：
//
//   ① 📥 ワンクリックでバックアップファイルをダウンロード保存
//      （全ブラウザ対応・最も確実。手動でボタンを押した時に保存する）
//   ② 📁 レシート保存フォルダに自動でバックアップファイルも書き出す
//      （対応ブラウザのみ・フォルダを設定していれば裏で自動更新される）
//
//   データが消えてしまった場合は「バックアップファイルから復元する」で
//   ①か②で保存したファイルを選ぶだけで元に戻せる。
// ==========================================

const LOCAL_BACKUP_FILENAME = 'haru-pos-backup.json';

/* =========================================================
   ① 手動バックアップ（ダウンロード保存）／ファイルから復元
   ========================================================= */

// 今のデータをJSONファイルとしてダウンロード保存する
function downloadDataBackupFile() {
    if (typeof playSound === 'function') playSound('click');
    if (typeof buildAllDataObject !== 'function') {
        console.warn('buildAllDataObject が見つかりません（auth-system.jsの読み込み順を確認してください）');
        return;
    }
    try {
        const dataObj = buildAllDataObject();
        const jsonStr = JSON.stringify(dataObj, null, 0);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const today = new Date().toISOString().slice(0, 10);
        const link = document.createElement('a');
        link.href = url;
        link.download = `haru-pos-backup_${today}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);

        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                "バックアップファイルを保存しました。大切な場所（USBメモリやパソコン内の分かりやすいフォルダなど）に保管してください。",
                "ばっくあっぷ ふぁいる を ほぞん し まし た。",
                () => {}, false
            );
        }
    } catch (err) {
        console.warn('バックアップファイルの作成に失敗しました:', err);
        if (typeof playSound === 'function') playSound('error');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm("バックアップファイルの作成に失敗しました。", "しっぱい し まし た。", () => {}, false);
        }
    }
}

// ファイル選択ダイアログから、保存しておいたバックアップファイル（.json）を選んで復元する
function restoreDataFromBackupFileInput(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (typeof playSound === 'function') playSound('click');

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const dataObj = JSON.parse(e.target.result);
            const savedAtLabel = dataObj.savedAt ? new Date(dataObj.savedAt).toLocaleString('ja-JP') : '不明';
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm(
                    `このバックアップ（保存日時: ${savedAtLabel}）で現在のデータを上書きします。よろしいですか？`,
                    "ばっくあっぷ から ふっきゅう し ます。 よろしい です か？",
                    (res) => {
                        if (!res) return;
                        applyImportedDataObject(dataObj);
                    },
                    true
                );
            } else if (confirm('バックアップから復元します。よろしいですか？')) {
                applyImportedDataObject(dataObj);
            }
        } catch (err) {
            console.warn('バックアップファイルの読み込みに失敗しました:', err);
            if (typeof playSound === 'function') playSound('error');
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm("ファイルの形式が正しくありません。正しいバックアップファイル（.json）を選んでください。", "ふぁいる の けいしき が ただしく あり ませ ん。", () => {}, false);
            }
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

/* =========================================================
   ② ローカルフォルダへの自動バックアップ（File System Access API対応ブラウザのみ）
   ------------------------------------------
   すでにレシート保存機能（ui.js の setupReceiptFolder）で
   フォルダへのアクセス許可を取得している場合、そのフォルダに
   「haru-pos-backup.json」というファイル名でデータの全体像を
   自動的に書き出す・更新する。receiptDirectoryHandle / savedDirectoryHandle
   は state.js で宣言済みのものをそのまま利用する。
   ========================================================= */

let lastFolderBackupSnapshot = null;

// isInitialSetup: true の場合のみファイルが無ければ新規作成する（フォルダ設定直後の初回書き込み用）。
// それ以外（定期実行・データ更新時）は、ファイルがすでに存在する場合のみ上書き保存する。
// → ユーザーがバックアップファイルを手動で削除した場合、そのまま尊重して自動では作り直さない。
async function writeBackupToFolderIfAvailable(isInitialSetup = false) {
    const handle = (typeof receiptDirectoryHandle !== 'undefined' && receiptDirectoryHandle)
        || (typeof savedDirectoryHandle !== 'undefined' && savedDirectoryHandle);
    if (!handle) return; // フォルダ未設定なら何もしない（②は対応ブラウザ・設定済みの場合のみ）
    if (typeof buildAllDataObject !== 'function') return;

    try {
        // 許可が失効していないか確認（ユーザー操作なしでも確認だけは可能）
        if (handle.queryPermission) {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') return; // 再許可はユーザー操作が必要なため、ここでは静かに諦める
        }

        if (!isInitialSetup) {
            // ファイルがすでに存在するか確認する（無ければ = 手動で削除された可能性があるため作り直さない）
            try {
                await handle.getFileHandle(LOCAL_BACKUP_FILENAME, { create: false });
            } catch (notFoundErr) {
                return; // ファイルが無い場合は何もしない
            }
        }

        const dataObj = buildAllDataObject();
        const jsonStr = JSON.stringify(dataObj);

        // 変化がなければ書き込みしない（無駄な書き込みを避ける）
        if (jsonStr === lastFolderBackupSnapshot) return;

        const fileHandle = await handle.getFileHandle(LOCAL_BACKUP_FILENAME, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        lastFolderBackupSnapshot = jsonStr;
    } catch (err) {
        // 権限切れ・フォルダ削除などは静かに無視する（毎回エラー表示すると邪魔になるため）
        console.warn('ローカルフォルダへの自動バックアップに失敗しました:', err);
    }
}

// 起動時：localStorageのデータがほぼ空（＝キャッシュ削除などで消えた直後）で、
// かつ以前設定したフォルダにバックアップファイルが残っている場合は、
// 復元するかどうかをユーザーに確認する
async function checkFolderBackupForRestoreOnStartup() {
    // すでに商品か店員のデータがあれば、消えていないので何もしない
    const hasExistingData = (localStorage.getItem('pos_products') && localStorage.getItem('pos_products') !== '[]') ||
        (localStorage.getItem('pos_clerks') && localStorage.getItem('pos_clerks') !== '[]');
    if (hasExistingData) return;

    // IndexedDBからの復元（index.html側の仕組み）がすでに走ってリロードする可能性があるため、
    // 少し待ってからチェックする
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (localStorage.getItem('pos_products')) return; // 待っている間にIndexedDBから復元された

    if (typeof loadHandleFromIndexedDB !== 'function') return;

    try {
        // savedDirectoryHandle はIndexedDBから非同期で読み込まれるため少し待つ
        await new Promise(resolve => setTimeout(resolve, 500));
        const handle = (typeof savedDirectoryHandle !== 'undefined') ? savedDirectoryHandle : null;
        if (!handle) return;

        if (handle.queryPermission) {
            const perm = await handle.queryPermission({ mode: 'read' });
            if (perm !== 'granted') return; // ユーザー操作なしでは再許可できないため諦める
        }

        const fileHandle = await handle.getFileHandle(LOCAL_BACKUP_FILENAME);
        const file = await fileHandle.getFile();
        const text = await file.text();
        const dataObj = JSON.parse(text);
        const savedAtLabel = dataObj.savedAt ? new Date(dataObj.savedAt).toLocaleString('ja-JP') : '不明';

        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `データが見つからないため確認します。設定済みのフォルダに保存日時「${savedAtLabel}」のバックアップがあります。これで復元しますか？`,
                "ばっくあっぷ が みつかり まし た。 ふっきゅう し ます か？",
                (res) => {
                    if (res) applyImportedDataObject(dataObj);
                },
                true
            );
        }
    } catch (err) {
        // フォルダ内にバックアップファイルがない、権限がないなどは通常運転なので静かに無視
    }
}

/* =========================================================
   フック：既存の window.haruPosBackupNow（IndexedDBへの保存）に相乗りし、
   同じタイミングでローカルフォルダへの書き出しも行う
   ========================================================= */
(function hookLocalBackupIntoExistingBackup() {
    function tryHook() {
        if (typeof window.haruPosBackupNow !== 'function') {
            setTimeout(tryHook, 500);
            return;
        }
        const originalBackupNow = window.haruPosBackupNow;
        window.haruPosBackupNow = function (...args) {
            const result = originalBackupNow.apply(this, args);
            writeBackupToFolderIfAvailable();
            return result;
        };

        // 起動直後にも一度バックアップを試みる（すでにファイルがある場合のみ更新）
        writeBackupToFolderIfAvailable();
        checkFolderBackupForRestoreOnStartup();
    }
    tryHook();
})();

// 何分かに1回、フォルダへ自動バックアップする（3分ごと）。
// ※ ユーザーがバックアップファイルを削除していた場合は作り直さない（writeBackupToFolderIfAvailable内で判定）。
setInterval(() => { writeBackupToFolderIfAvailable(); }, 3 * 60 * 1000);

document.addEventListener('DOMContentLoaded', () => {
    const restoreInput = document.getElementById('backup-restore-file-input');
    if (restoreInput) {
        restoreInput.addEventListener('change', restoreDataFromBackupFileInput);
    }
});
