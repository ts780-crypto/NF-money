const CACHE_NAME = 'nf-app-v7';

// 事前キャッシュ対象リスト
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

// インストール処理
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// アクティベート処理（古いキャッシュの自動破棄）
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// フェッチ処理（HTMLは Network-First、その他静的ファイルは Cache-First）
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  // 1. HTML（ページ遷移）リクエストは Network-First（最新版を優先取得）
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // ネットワーク取得成功時はキャッシュを更新
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => {
          // オフライン時はキャッシュから返す
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
    return;
  }

  // 2. その他の静的アセット（CSS, JS, 画像等）は Cache-First
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });
    })
  );
});
