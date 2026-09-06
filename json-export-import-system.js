// ==========================================
// json-export-import-system.js
// ------------------------------------------
// 【背景】
// Google Driveバックアップ・売上のXLSX出力はあるが、アプリの「設定データ
// 一式」（商品マスター、会員、店員、レシート文言、backup-extra-settings-sync.js
// が拾っている各種追加設定など）をまるごと手動でファイルに書き出し／
// 読み込みする手段が無かった。
// Googleアカウントを切り替えたい時や、オフライン環境のPCから別のPCへ
// 手動でデータを引っ越したい時などの「最後の命綱」として、
// JSONファイルへの一括エクスポート／インポート機能を用意する。
//
// 【今回追加】gzip圧縮
// ------------------------------------------
// 商品数・会員数・履歴が増えてくると、無圧縮のJSONファイルは数MB〜
// 数十MBになることがあり、メール添付やUSBメモリでのやり取り・
// スマホでの保存が重くなる原因になっていた。
// テキスト形式のJSONは同じ文字列の繰り返し（キー名など）が非常に多く
// 圧縮が効きやすいため、書き出し時にブラウザ標準の圧縮機能
// （CompressionStream('gzip')）でその場でgzip圧縮してから保存する。
// 読み込み側（インポート）は、gzip圧縮されたファイル（.json.gz）と、
// 従来の無圧縮JSON（.json）の両方に対応する（ファイルの中身の先頭
// バイトを見て自動判別するため、拡張子を気にせず選んでもらってよい）。
// これにより、これまでに保存した無圧縮バックアップファイルも
// 引き続き復元に使える。
// ・CompressionStream / DecompressionStream は最新のブラウザ
// 　（Chrome/Edge 80+、Safari 16.4+、Firefox 113+）で使える標準API。
// 　非対応の古いブラウザでは、書き出しは自動的に従来通りの
// 　無圧縮JSONにフォールバックする（読み込み側は元々無圧縮にも
// 　対応しているので、片方だけ非対応でも困らない）。
//
// 【この機能】
// データ管理画面(migration-screen)に、
//   ・「💾 圧縮して書き出す」ボタン
//   ・「📂 バックアップから復元する」ボタン（ファイル選択）
// を追加する。
//
// 中身は buildAllDataObject() / applyImportedDataObject()（auth-system.js）
// をそのまま利用する。この2つの関数は backup-extra-settings-sync.js に
// よってすでに拡張されているため、商品・会員・店員・履歴に加えて
// 給与・税設定・自動化バーコード・呼び出し番号・保留中の会計・
// タッチパネル画像設定なども含めて、まるごと1つのファイルに
// 書き出される（＝Google Driveバックアップと同じ内容がファイルとして
// 手元に残る）。
//
// 【index.html側の「💾 データのバックアップ」ブロックとの違い】
// index.html にもともとある「📥 バックアップファイルを保存する」は
// 同じデータを無圧縮のJSONのまま保存する。こちらは同じ内容を
// gzip圧縮して1ファイルのサイズを小さくする版であり、単純な重複では
// ないため、両方を残している（スマホの空き容量が少ない・メールに
// 添付したい、といった場合はこちらの圧縮版が便利）。
//
// auth-system.js / index.html は直接編集せず、DOM注入＋既存関数の呼び出し
// だけで実現する（他の追加機能ファイルと同じ「後付けブロック」方式）。
// ==========================================

/* =========================================================
   ①-0 gzip圧縮・展開の共通ヘルパー
   ========================================================= */
function isGzipCompressionSupported() {
    return typeof CompressionStream !== 'undefined';
}

function isGzipDecompressionSupported() {
    return typeof DecompressionStream !== 'undefined';
}

async function gzipCompressText(text) {
    const srcBytes = new TextEncoder().encode(text);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(srcBytes);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
}

async function gunzipToText(bytes) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
}

function formatBytesForBackup(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

/* =========================================================
   ① 書き出し（エクスポート）
   ========================================================= */
async function exportAllDataAsJsonFile() {
    if (typeof playSound === 'function') playSound('click');

    if (typeof buildAllDataObject !== 'function') {
        console.warn('buildAllDataObject() が見つかりません。auth-system.js の読み込みを確認してください。');
        return;
    }

    try {
        const dataObj = buildAllDataObject();
        const json = JSON.stringify(dataObj);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

        let blob, filename;
        if (isGzipCompressionSupported()) {
            const gzBytes = await gzipCompressText(json);
            blob = new Blob([gzBytes], { type: 'application/gzip' });
            filename = `haru-pos-backup_${stamp}.json.gz`;
        } else {
            // 【フォールバック】古いブラウザ等でgzip圧縮に対応していない場合は、
            // これまで通り無圧縮のJSONで保存する（機能自体は使える状態を保つ）。
            blob = new Blob([json], { type: 'application/json' });
            filename = `haru-pos-backup_${stamp}.json`;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const sizeText = formatBytesForBackup(blob.size);
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm(
                `設定データを書き出しました（${filename} / ${sizeText}）。大切に保管してください。`,
                'ぜんぶ の でーた を ほぞん し まし た。',
                () => {}, false
            );
        }
    } catch (err) {
        console.error('JSONエクスポートに失敗しました:', err);
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('書き出しに失敗しました。もう一度お試しください。', 'かきだし に しっぱい し まし た。', () => {}, false);
        }
    }
}

/* =========================================================
   ② 読み込み（インポート）
   ------------------------------------------
   gzip圧縮ファイル(.json.gz)・従来の無圧縮JSON(.json)のどちらでも
   復元できるよう、拡張子ではなくファイルの中身の先頭バイト
   （gzipは必ず 0x1f 0x8b から始まる）を見て自動判別する。
   ========================================================= */
function triggerImportJsonFile() {
    if (typeof playSound === 'function') playSound('click');
    const input = document.getElementById('json-import-file-input');
    if (input) {
        input.value = ''; // 同じファイルを連続で選んだ時もchangeイベントが発火するようにする
        input.click();
    }
}

async function decodeImportedBackupBytes(bytes) {
    const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!isGzip) {
        return new TextDecoder('utf-8').decode(bytes);
    }
    if (!isGzipDecompressionSupported()) {
        throw new Error('GZIP_UNSUPPORTED');
    }
    return await gunzipToText(bytes);
}

function handleImportJsonFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
        let text;
        try {
            const bytes = new Uint8Array(reader.result);
            text = await decodeImportedBackupBytes(bytes);
        } catch (err) {
            console.error('バックアップファイルの展開に失敗しました:', err);
            if (typeof showCustomConfirm === 'function') {
                const msg = (err && err.message === 'GZIP_UNSUPPORTED')
                    ? 'このブラウザは圧縮バックアップファイル(.gz)の展開に対応していません。最新のブラウザでお試しいただくか、無圧縮のJSONファイルをご利用ください。'
                    : 'このファイルは読み込めませんでした。';
                showCustomConfirm(msg, 'よみこめ ませ ん でし た。', () => {}, false);
            }
            return;
        }

        let dataObj;
        try {
            dataObj = JSON.parse(text);
        } catch (err) {
            if (typeof showCustomConfirm === 'function') {
                showCustomConfirm('このファイルは読み込めませんでした（JSON形式ではありません）。', 'よみこめ ませ ん でし た。', () => {}, false);
            }
            return;
        }

        if (typeof showCustomConfirm !== 'function') return;
        showCustomConfirm(
            '現在のデータをすべて、このファイルの内容で上書きします。元に戻せません。本当によろしいですか？',
            'いま の でーた を うわがき し ます か？',
            (ok) => {
                if (!ok) return;
                runImportJsonFile(dataObj);
            },
            true
        );
    };
    reader.onerror = () => {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('ファイルの読み込み中にエラーが発生しました。', 'えらー が はっせい し まし た。', () => {}, false);
        }
    };
    // 圧縮ファイルはバイナリのため、テキストではなくバイト列として読み込む
    reader.readAsArrayBuffer(file);
}

function runImportJsonFile(dataObj) {
    if (typeof applyImportedDataObject !== 'function') {
        console.warn('applyImportedDataObject() が見つかりません。auth-system.js の読み込みを確認してください。');
        return;
    }
    try {
        applyImportedDataObject(dataObj);
        if (typeof window.haruPosBackupNow === 'function') window.haruPosBackupNow();
        if (typeof playSound === 'function') playSound('success');
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('データを復元しました。画面を再読み込みします。', 'ふっきゅう し まし た。', () => {
                location.reload();
            }, false);
        } else {
            location.reload();
        }
    } catch (err) {
        console.error('JSONインポートに失敗しました:', err);
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm('復元に失敗しました。ファイルの内容をご確認ください。', 'ふっきゅう に しっぱい し まし た。', () => {}, false);
        }
    }
}

/* =========================================================
   ③ データ管理画面へのブロック追加
   ========================================================= */
function ensureJsonExportImportBlock() {
    if (document.getElementById('json-export-import-block')) return;
    const container = document.getElementById('migration-screen');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'json-export-import-block';
    block.className = 'migration-block';
    block.style.cssText = 'background:#fff3e0; border:2px solid #ffb74d; padding:15px; border-radius:6px; margin-top:15px;';
    block.innerHTML = `
        <h3 class="migration-title" style="color:#e65100;">💾 設定データの手動バックアップ（gzip圧縮）</h3>
        <p style="font-size:12px; color:#777; margin:4px 0 12px;">
            商品・会員・店員・履歴に加え、給与や自動化バーコードなどの追加設定もまとめて
            1つのファイルに、gzip形式で圧縮して書き出せます（同じ内容の無圧縮JSONより
            ファイルサイズを大幅に小さくできます）。Googleアカウントの切り替え時や、
            オフライン環境でのお引っ越し、メール添付での送付などにご利用ください。
            以前保存した無圧縮のJSONファイルも、そのまま復元に使えます。
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button id="json-export-btn" type="button" style="flex:1; min-width:180px; padding:12px; border:none; border-radius:8px; background:#fb8c00; color:#fff; font-weight:bold; cursor:pointer;">
                💾 圧縮して書き出す
            </button>
            <button id="json-import-btn" type="button" style="flex:1; min-width:180px; padding:12px; border:none; border-radius:8px; background:#fff; color:#e65100; border:2px solid #fb8c00; font-weight:bold; cursor:pointer;">
                📂 バックアップから復元する
            </button>
        </div>
        <input type="file" id="json-import-file-input" accept="application/json,.json,application/gzip,.gz,.json.gz" style="display:none;">
    `;
    container.appendChild(block);

    block.querySelector('#json-export-btn').addEventListener('click', exportAllDataAsJsonFile);
    block.querySelector('#json-import-btn').addEventListener('click', triggerImportJsonFile);
    block.querySelector('#json-import-file-input').addEventListener('change', handleImportJsonFileSelected);
}

(function hookShowScreenForJsonExportImportBlock() {
    function tryHook() {
        if (typeof window.showScreen !== 'function') {
            setTimeout(tryHook, 300);
            return;
        }
        const original = window.showScreen;
        window.showScreen = function (screenId, ...rest) {
            const result = original.apply(this, [screenId, ...rest]);
            if (screenId === 'migration-screen') ensureJsonExportImportBlock();
            return result;
        };
    }
    tryHook();
})();

document.addEventListener('DOMContentLoaded', () => {
    // データ管理画面がすでに開いている状態でリロードされた場合にも対応
    if (document.getElementById('migration-screen')?.classList.contains('active')) {
        ensureJsonExportImportBlock();
    }
});
