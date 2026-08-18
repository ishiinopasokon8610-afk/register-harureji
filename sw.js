const CACHE_NAME = 'register-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// インストール時にファイルをキャッシュする
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// キャッシュがあればそこからページを表示する
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
