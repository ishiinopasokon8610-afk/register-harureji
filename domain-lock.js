// ==========================================
// domain-lock.js
// 許可したURL（ドメイン）以外でこのページが開かれた時、
// 画面を表示させない（＝JS/CSSが実質意味をなさなくする）
// ------------------------------------------
// 【重要な前提（正直な説明）】
// これは「ソースコードを見られなくする」対策ではありません。
// view-source や 名前を付けて保存 で HTML/CSS/JS の中身自体を見ることは、
// ブラウザの仕組み上どうしても防げません。
//
// このスクリプトが防ぐのは、「コピーしたファイル一式をそのまま
// 別のサーバー・別のURLにアップロードして、そのまま動かす」という
// カジュアルなコピー流用です。ドメインが一致しなければ、
// 画面の中身を空にしてしまうことで、コピーしても「動くPOSシステム」
// としては機能しなくなります。
//
// 【弱点（隠さず書きます）】
// このファイルの中身も結局はブラウザに送られてくるJSなので、
// 技術力のある人が「このチェック部分だけ消す」という編集をすれば
// 突破できてしまいます。本当に強固な保護がしたい場合は、
// JS/CSS自体をサーバー側（Cloud Functions等）でOriginヘッダーを検証して
// から配信する方式にする必要があります（このファイルの末尾のコメント参照）。
//
// 【使い方】
// 1. 下の ALLOWED_HOSTNAMES に、実際にこのPOSを公開しているドメインを入れる
// 2. このファイルを、index.html の <head> のいちばん最初（他のどの<script>よりも前）
//    に読み込む。可能であれば <script src="domain-lock.js"> ではなく、
//    このファイルの中身をそのまま <script>...</script> として直接HTMLに埋め込むほうが、
//    別ファイルとして丸ごと差し替えられるリスクを減らせるのでより安全。
// ==========================================

(function () {
    // ↓↓↓ ここに、本番で使う正式なドメインを入れてください（例: 'example.com'） ↓↓↓
    const ALLOWED_HOSTNAMES = [
        'example.com',
        'www.example.com'
        // 開発・動作確認用に自分のPCで開く場合は 'localhost' や '127.0.0.1' も一時的に追加してよい
    ];

    // 許可されていないドメインで開かれた時に、飛ばしたい「本物のURL」
    const CANONICAL_URL = 'https://example.com/';

    const currentHost = window.location.hostname;
    // file:// でローカルのHTMLファイルを直接開いた場合はhostnameが空文字になるため、
    // ここでも通常通り読み込みを続けさせる（USBメモリ配布・手元での動作確認などを想定）
    const isFileProtocol = window.location.protocol === 'file:';
    const isAllowed = isFileProtocol || ALLOWED_HOSTNAMES.indexOf(currentHost) !== -1;

    if (isAllowed) return; // 正規のURL、またはローカルファイル → 何もせず通常通り読み込みを続ける

    // ---- ここから先は「許可されていないドメイン」で開かれた場合の処理 ----

    // 1. これから読み込まれる予定の他のCSS/JSファイルを止める
    //    （document.write で新しいHTMLを丸ごと上書きすることで、
    //      これ以降に書かれている <link>/<script> タグの読み込み自体を止める。
    //      redirect中の一瞬、コピーサイトの中身が見えてしまわないようにするため）
    document.open();
    document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>移動しています…</title>' +
        '<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#222;color:#eee;text-align:center;}</style>' +
        '</head><body><div>正しいページに移動しています…</div></body></html>'
    );
    document.close();

    // 2. 本物のURLへ移動する。
    //    location.replace() を使うことで履歴に残さない
    //    （コピーサイト→正規サイトの後、ブラウザの「戻る」を押してもコピーサイトには戻らない）。
    //    CANONICAL_URL 自体のホスト名が誤って ALLOWED_HOSTNAMES に含まれていない場合、
    //    無限リダイレクトになってしまうため、その事故を防ぐ簡易チェックを入れておく。
    try {
        const canonicalHost = new URL(CANONICAL_URL).hostname;
        if (ALLOWED_HOSTNAMES.indexOf(canonicalHost) === -1) {
            console.warn('domain-lock: CANONICAL_URLのホスト名がALLOWED_HOSTNAMESに含まれていません。設定を見直してください。');
        }
    } catch (e) {}
    window.location.replace(CANONICAL_URL);

    // 3. すでに実行中のスクリプト（このファイルより後ろにあるインラインscript等）を
    //    それ以上進めないよう、例外を投げて処理を止める
    //    （location.replace()は非同期にページ遷移が始まるため、遷移完了までの間に
    //      後続のスクリプトが動いてしまわないようにする保険）
    throw new Error('domain-lock: 許可されていないドメインのため ' + CANONICAL_URL + ' へ移動します (' + currentHost + ')');
})();

/* =========================================================
   さらに強固にしたい場合（参考）
   ------------------------------------------
   上のクライアント側チェックは「編集すれば突破される」弱点が必ず残ります。
   本当に「そのドメイン以外ではJS/CSSの中身自体を読めない」ようにしたい場合は、
   ファイルを静的配信するのをやめて、Cloud Functions（または他のサーバー）経由で
   以下のように配信する方式にします：

   exports.serveAppJs = functions.https.onRequest((req, res) => {
       const origin = req.get('Origin') || req.get('Referer') || '';
       if (!origin.startsWith('https://example.com')) {
           res.status(403).send('Forbidden');
           return;
       }
       res.set('Content-Type', 'application/javascript');
       res.send(APP_JS_SOURCE_CODE); // 実際のJSの中身
   });

   この方式なら、ブラウザ側でチェックを書き換える余地がそもそも無く
   （リクエストの時点でサーバーが拒否するため）、コピーしたHTMLから
   このURLを直接読み込もうとしても403で弾かれます。
   ただし構成が「静的ホスティングのみ」から「サーバーが必要」に変わるため、
   今のFirebase構成からの見直しが必要になります。
   ========================================================= */
