const CACHE_NAME = 'nf-app-v2'; // バージョンを v2 に更新
const ASSETS = [
  './',
  './index.html',
  './viewer.html',
  './style.css',
  './app.js',
  './viewer.js',
  './manifest.json',
  './apple-touch-icon.png'
];

// キャッシュの保存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// オフライン時のキャッシュ応答
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
