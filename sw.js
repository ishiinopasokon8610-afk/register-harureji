const CACHE_VERSION = 'v11';
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
      // 1件ずつ手で列挙する方式にしなかったのは、extra-settings-sync.js
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
