/* ============================================================
   My Premium YouTube - Service Worker
   Professional PWA Caching Strategies
   ============================================================ */

const CACHE_VERSION = 'v1.0.0';
const STATIC_CACHE   = 'mytube-static-' + CACHE_VERSION;
const RUNTIME_CACHE  = 'mytube-runtime-' + CACHE_VERSION;
const IMAGE_CACHE    = 'mytube-images-' + CACHE_VERSION;

// Assets to pre-cache on install (app shell)
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icon-512.png',
    'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap',
    'https://fonts.googleapis.com/icon?family=Material+Icons'
];

/* ----- Install: Pre-cache App Shell ----- */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE_URLS).catch(err => {
                console.warn('[SW] Precache partial failure:', err);
            }))
            .then(() => self.skipWaiting())
    );
});

/* ----- Activate: Clean Old Caches ----- */
self.addEventListener('activate', event => {
    const validCaches = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE];
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (!validCaches.includes(key)) {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

/* ----- Helper: Caching Strategies ----- */

// Cache First - for static assets (CSS, JS, fonts)
async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const res = await fetch(request);
        if (res && res.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, res.clone());
        }
        return res;
    } catch (err) {
        return cached || Response.error();
    }
}

// Network First - for HTML and API calls (with offline fallback)
async function networkFirst(request, cacheName) {
    try {
        const res = await fetch(request);
        if (res && res.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, res.clone());
        }
        return res;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Offline fallback to app shell for navigation requests
        if (request.mode === 'navigate') {
            return caches.match('./index.html');
        }
        return Response.error();
    }
}

// Stale While Revalidate - for images and thumbnails
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request).then(res => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
    }).catch(() => cached);
    return cached || fetchPromise;
}

/* ----- Fetch Event: Apply Strategy Based on Request ----- */
self.addEventListener('fetch', event => {
    const { request } = event;

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Skip cross-origin requests that aren't CDN assets (e.g. firebase, youtube embed)
    if (url.origin !== self.location.origin) {
        // Handle Google Fonts and Material Icons
        if (url.hostname === 'fonts.googleapis.com' ||
            url.hostname === 'fonts.gstatic.com') {
            event.respondWith(cacheFirst(request, STATIC_CACHE));
            return;
        }
        // Handle YouTube thumbnail images
        if (url.hostname === 'i.ytimg.com' ||
            url.hostname === 'i.pravatar.cc') {
            event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
            return;
        }
        // Let other cross-origin requests pass through (Firebase, YouTube API, Embeds)
        return;
    }

    // Navigation requests (HTML pages) - Network First
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, RUNTIME_CACHE));
        return;
    }

    // Static assets (CSS, JS, fonts) - Cache First
    if (request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'font') {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // Images - Stale While Revalidate
    if (request.destination === 'image') {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
        return;
    }

    // Manifest - Cache First
    if (url.pathname === '/manifest.json' || url.pathname.endsWith('manifest.json')) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // Default - Network First
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

/* ----- Message Handler: Skip Waiting / Manual Update ----- */
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then(keys => {
            return Promise.all(keys.map(k => caches.delete(k)));
        }).then(() => {
            event.ports[0] && event.ports[0].postMessage({ done: true });
        });
    }
});

/* ----- Background Sync (for future use) ----- */
self.addEventListener('sync', event => {
    if (event.tag === 'sync-comments') {
        event.waitUntil(
            // Future: sync pending comments when back online
            Promise.resolve()
        );
    }
});

/* ----- Push Notifications (for future use) ----- */
self.addEventListener('push', event => {
    if (!event.data) return;
    const data = event.data.json();
    const options = {
        body: data.body || '',
        icon: './icon-512.png',
        badge: './icon-512.png',
        vibrate: [100, 50, 100],
        data: { url: data.url || './' }
    };
    event.waitUntil(
        self.registration.showNotification(data.title || 'My Premium YouTube', options)
    );
});

/* ----- Notification Click ----- */
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            for (const client of clientList) {
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url);
            }
        })
    );
});
