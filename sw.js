// Cache-Version hochzählen, wenn sich index.html/app.js ändern,
// damit Nutzer die neue Version bekommen statt der alten aus dem Cache.
const CACHE_NAME = 'haushaltskasse-v3';

const APP_SHELL = [
    './',
    './index.html',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Supabase-Requests (Daten, Realtime) NIE cachen - die müssen
    // immer live sein. Nur die eigene App-Hülle wird gecacht.
    if (url.hostname.includes('supabase.co')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            return (
                cached ||
                fetch(event.request).catch(() => cached)
            );
        })
    );
});