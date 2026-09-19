// ==========================================
// sw.js
// ------------------------------------------
// 【今回の改良】
// 従来は index.html / manifest.json を「キャッシュ優先・一度取得したら
// ずっとキャッシュから返す」方式にしていたため、update-notification-system.js
// が「新バージョンがあります」と通知して利用者がリロードしても、
// このService Worker自体が index.html を古いキャッシュのまま返し続けて
// しまい、実質的に更新が反映されない、という食い違いが起きうる状態だった。
// （JSファイル本体は元々ASSETSに含まれておらずキャッシュされないため
// 　問題なかったが、殻となるindex.htmlだけがずっと古いままになりうる。）
//
// 今回、以下の2点を改良する。
// ① CACHE_NAME にバージョン番号を持たせ、activateのタイミングで
//    古い世代のキャッシュを自動的に削除する（更新のたびに手動で
//    キャッシュ名を変える運用にしておけば、確実に総入れ替えできる）。
// ② index.html／'./'（アプリの殻）へのアクセスは「まずネットワークから
//    取得し、取れたらキャッシュも更新する。オフライン等で失敗した
//    ときだけキャッシュを使う」方式（ネットワーク優先）に変更する。
//    これにより、通常のオンライン時は常に最新のindex.htmlが使われ、
//    オフラインでも今まで通りアプリを開けるという両立ができる。
// それ以外の静的ファイル（manifest.jsonなど）は、これまで通り
// キャッシュ優先のままにしておく（会計中の通信が不安定な瞬間でも、
// レジ本体の表示が引っかからないようにするため）。
//
// 【運用方法】
// 今後、大きな更新を配布するときは CACHE_VERSION の値も
// （例: 'v2' → 'v3'）書き換えておくと、activate時に古いキャッシュが
// 確実に一掃されます（update-notification-system.js の APP_VERSION と
// 同じタイミングで一緒に上げておくと分かりやすいです）。
// ==========================================

// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・新機能: メニュー画面で、ジャンルごとに「列数×行数（1ページの件数）」を
//   設定できるようにした（menu-genre-page-grid-system.js）。設定した
//   ジャンルは「‹ 前へ／次へ ›」のページ送り表示になる。未設定のジャンルは
//   これまで通り全件スクロール表示のまま（非破壊）。設定はAblyで他端末にも
//   共有される。
// ・不具合修正: 「🔔 店員を呼ぶ」で登録される自動化バーコード（CALL〜）が
//   使い切り（oneTime）設定になっておらず、対応後もバーコード一覧に残り
//   続けていた点を修正（call-staff-barcode-onetime-fix.js）。
// ・不具合修正: manifest.json の icons に、完全に同一内容のアイコンが
//   誤って2つ登録されていた（重複）ため、1つに整理した。
// これらのJSファイルはASSETSに含めておらずキャッシュ対象外のため常に
// 最新が読み込まれるが、index.htmlに新しい<script>タグを追加したため、
// 念のためCACHE_VERSIONを上げて古いindex.htmlキャッシュを一掃する。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: install時にASSETS（index.html/manifest.jsonのみ）しか
//   キャッシュしておらず、追加機能スクリプト（register.js等80個近く）が
//   一切キャッシュ対象外だったため、オフライン時に殻（index.html）だけ
//   開けて中身が動かない状態だった点を修正。index.htmlの<script src>を
//   動的に読み取って同一オリジンのスクリプトも全てプリキャッシュする
//   ように変更（shop-id-system.js。詳細は下のinstallハンドラのコメント参照）。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: 「pushした直後だと、アップデートされていない状態が出る」
//   原因の1つは、GitHub Pagesが返すファイルにCache-Control: max-age=600
//   （＝ブラウザが10分間は再確認せず手元のコピーを使ってよい）が付くこと。
//   install時のプリキャッシュ（cache.addAll / cache.add）も、アプリの殻の
//   ネットワーク優先（fetch(req)）も、この「ブラウザ標準のHTTPキャッシュ」を
//   経由していたため、直近10分以内に一度取得したファイルは、サーバーに
//   新しい版があっても「古い版」がそのまま新しいCACHE_NAMEのキャッシュへ
//   入ってしまっていた。そのうえ scriptはキャッシュ優先なので、一度古い版が
//   入るとCACHE_VERSIONを次に上げるまで古いまま固定されてしまう。
//   → プリキャッシュは cache:'reload'（HTTPキャッシュを使わず必ずサーバーから
//   取得）、アプリの殻のネットワーク優先は cache:'no-cache'（毎回サーバーに
//   確認）に変更した。
// ・改善: ネットワークから取れた応答が正常（res.ok）な時だけ殻のキャッシュを
//   更新する（エラー応答で正しいキャッシュを上書きしないため）。
//   オフライン時、殻のURLがキャッシュと完全一致しなくても
//   ./index.html を返せるようにした。
// ==========================================
// ==========================================
// 【今回の更新内容（変更点まとめ）】
// ・不具合修正: Googleドライブ連携済みの端末で、アプリを開き直すたびに
//   「データの取り込みが完了しました」の通知が毎回出てしまう点を修正した
//   （google-drive-auto-restore-dedup-fix.js）。起動時の自動復元
//   （autoRestoreFromGoogleDriveOnLoad）の実行中だけ、Driveバックアップの
//   保存時刻（savedAt）が前回自動取り込みした時と同じであれば、取り込み処理
//   （＝完了通知も含む）自体をスキップする。手動の「📥 Driveから復元」や
//   JSONファイルからの復元は、これまで通り毎回きちんと取り込む。
// ・このファイルは index.html に <script> タグを追加するだけで、上のinstall時の
//   動的プリキャッシュ（<script src>の自動読み取り）の対象に自動で入る。
//   sw.js にファイル名を書き足す必要はない。ただし、配布する時は
//   CACHE_VERSION（このファイル）と APP_VERSION（update-notification-system.js）
//   の2つを、手動で一緒に上げること（CACHE_VERSIONが同じままだと、
//   キャッシュ優先のスクリプトが古いまま入れ替わらない）。
// ==========================================
const CACHE_VERSION = 'v4';
const CACHE_NAME = `register-cache-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// ブラウザ標準のHTTPキャッシュ（GitHub Pagesは最大10分）を使わず、必ず
// サーバーから最新を取得するためのリクエストを作る（プリキャッシュ用）
function freshRequest(url) {
  return new Request(url, { cache: 'reload' });
}

// アプリの殻（ナビゲーション本体）とみなすリクエストかどうか
function isAppShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

// インストール時にファイルをキャッシュする
self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS.map(freshRequest));

      // 【今回追加：追加機能スクリプトのプリキャッシュ】
      // これまで ASSETS には index.html／manifest.json しか入っておらず、
      // register.js・ui.js・各種 ○○-system.js 等（80個近く）は一切
      // キャッシュされていなかった。そのため「オフラインでも今まで通り
      // アプリを開けるという両立ができる」と書いていたが、実際には
      // オフライン時に開けるのは index.html の殻だけで、中身のスクリプトが
      // 1つも読み込めず、実質的に機能しない状態だった。
      //
      // 対応：index.html を取得して <script src="..."> を動的に読み取り、
      // 同一オリジンのものを全てこのキャッシュにも追加する。ファイルを
      // 1件ずつ手で列挙する方式にしなかったのは、extra-settings-ably-sync.js
      // 等と同じ理由（新しいスクリプトを追加するたびにこのsw.jsを更新し
      // 忘れる、という抜け漏れを防ぐため）。
      // 1件のプリキャッシュが失敗しても（一時的な通信不良など）install
      // 全体は失敗させず、その1件だけ諦めて続行する。
      try {
        const htmlRes = await fetch('./index.html', { cache: 'no-store' });
        const html = await htmlRes.text();
        const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
          .map((m) => m[1])
          .filter((src) => !/^https?:\/\//i.test(src)); // 外部CDN等（同一オリジン以外）は対象外

        await Promise.all(
          scriptSrcs.map((src) =>
            cache.add(freshRequest(src)).catch((err) => {
              console.warn(`[sw] プリキャッシュに失敗しました（このファイルだけスキップ）: ${src}`, err);
            })
          )
        );
      } catch (err) {
        // index.html自体の取得に失敗した場合（インストール時点で既に
        // オフライン等）。ASSETS分（殻）は既にキャッシュできているので、
        // ここは諦めて続行する。
        console.warn('[sw] スクリプト一覧の動的プリキャッシュに失敗しました:', err);
      }
    })()
  );
  // 【今回追加】新しいService Workerを、古いものの終了を待たずすぐに
  // 有効化する。update-notification-system.js側の「リロード」操作と
  // 組み合わせることで、通知を見た利用者がリロードした瞬間に確実に
  // 新しいService Workerへ切り替わるようにするため。
  self.skipWaiting();
});

// 【今回追加】起動時に、今のバージョン以外の古いキャッシュを削除する
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // GET以外（POST等）はService Workerを介さず、そのままネットワークへ
  if (req.method !== 'GET') return;

  if (isAppShellRequest(req)) {
    // ① アプリの殻：ネットワーク優先。取得できたらキャッシュも更新する。
    e.respondWith(
      // cache:'no-cache' ＝ HTTPキャッシュにコピーがあっても、必ずサーバーに
      // 「更新されていないか」を確認してから使う（max-age=600の間の古い殻を防ぐ）
      fetch(req, { cache: 'no-cache' }).then((networkRes) => {
        if (networkRes.ok) {
          const clone = networkRes.clone();
          e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)));
        }
        return networkRes;
      }).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  // ② それ以外：キャッシュ優先（無ければネットワーク）
  // 上記のinstall時プリキャッシュにより、追加機能スクリプト等も
  // ここでキャッシュヒットするようになった。バージョン更新時は
  // CACHE_VERSIONを上げることで、activateで古いキャッシュごと
  // 一掃され、次のinstallで新しい内容が入り直す。
  e.respondWith(
    caches.match(req).then((response) => {
      return response || fetch(req);
    })
  );
});
