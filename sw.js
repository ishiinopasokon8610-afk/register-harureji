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

const CACHE_VERSION = 'v2';
const CACHE_NAME = `register-cache-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// アプリの殻（ナビゲーション本体）とみなすリクエストかどうか
function isAppShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

// インストール時にファイルをキャッシュする
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
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
      fetch(req).then((networkRes) => {
        const clone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return networkRes;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // ② それ以外：これまで通りキャッシュ優先（無ければネットワーク）
  e.respondWith(
    caches.match(req).then((response) => {
      return response || fetch(req);
    })
  );
});
