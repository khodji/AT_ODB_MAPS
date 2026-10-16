const CACHE_NAME = 'pcp-algerie-telecom-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/db.js',
  './js/tileManager.js',
  './js/app.js',
  './libs/leaflet.js',
  './libs/leaflet.css',
  './libs/leaflet.markercluster.js',
  './libs/MarkerCluster.css',
  './libs/MarkerCluster.Default.css',
  './libs/images/marker-icon.png',
  './libs/images/marker-icon-2x.png',
  './libs/images/marker-shadow.png',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // If request is for map tile, let tileManager or network handle it
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('server.arcgisonline.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return fallback empty/transparent tile if completely offline and not in IndexedDB
        return new Response('', { status: 404 });
      })
    );
    return;
  }

  // Cache-first strategy for app shell assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
