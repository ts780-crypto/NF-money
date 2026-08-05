const CACHE_NAME = 'nf-app-v3'; // バージョンを v3 に更新

// キャッシュ対象ファイルリスト（input.html に修正）
const ASSETS = [
  './',
  './index.html',
  './input.html',
  './style.css',
  './app.js',
  './viewer.js',
  './manifest.json',
  './apple-touch-icon.png'
];

// インストール処理（即時適用＆キャッシュ追加）
self.addEventListener('install', (event) => {
  self.skipWaiting(); // 新しいSWをすぐに有効化
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// アクティベート処理（古いバージョンのキャッシュ削除）
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // すべてのタブをすぐに新しいSWの制御下に置く
  );
});

// オフライン対応（キャッシュ優先で即座に返す）
self.addEventListener('fetch', (event) => {
  // HTTP / HTTPS 以外のリクエストはスキップ
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // キャッシュが存在すればそれを返す
        return cachedResponse;
      }
      // キャッシュがなければネットワークから取得
      return fetch(event.request).catch(() => {
        // オフラインかつHTMLリクエストの場合は index.html を返す
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
