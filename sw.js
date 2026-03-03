// =========================================
// Service Worker – Daglig Helse v2.1.2
// =========================================
const CACHE_NAME = 'daglig-helse-v2.1.2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css?v=2.1.2',
    './app.js?v=2.1.2',
    './firebase-config.js?v=2.1.2',
    './manifest.json?v=2.1.2',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Firebase/Google URLs som IKKE skal caches
const NETWORK_ONLY_PATTERNS = [
    'firestore.googleapis.com',
    'www.googleapis.com',
    'securetoken.googleapis.com',
    'identitytoolkit.googleapis.com',
    'accounts.google.com',
    'apis.google.com',
    'www.gstatic.com/firebasejs'
];

// ---- INSTALL ----
self.addEventListener('install', event => {
    console.log('[SW] Installerer v2.1.2...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// ---- ACTIVATE ----
self.addEventListener('activate', event => {
    console.log('[SW] Aktiverer v2.1.2...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Sletter gammel cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ---- FETCH ----
self.addEventListener('fetch', event => {
    const url = event.request.url;
    
    // Network-only for Firebase/Google API-kall
    if (NETWORK_ONLY_PATTERNS.some(pattern => url.includes(pattern))) {
        event.respondWith(fetch(event.request));
        return;
    }
    
    // Stale-while-revalidate for andre ressurser
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request)
                .then(networkResponse => {
                    if (networkResponse && networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Offline fallback for navigering
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                    return cachedResponse;
                });
            
            return cachedResponse || fetchPromise;
        })
    );
});

// ---- PUSH NOTIFICATIONS (for fremtidig bruk) ----
self.addEventListener('push', event => {
    if (!event.data) return;
    
    const data = event.data.json();
    const options = {
        body: data.body || 'Du har en ny påminnelse',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        vibrate: [200, 100, 200],
        tag: data.tag || 'daglig-helse',
        renotify: true,
        actions: data.actions || []
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'Daglig Helse', options)
    );
});

// ---- NOTIFICATION CLICK ----
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Fokuser på eksisterende vindu
                for (const client of windowClients) {
                    if (client.url.includes('index.html') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Åpne nytt vindu
                if (clients.openWindow) {
                    return clients.openWindow('./index.html');
                }
            })
    );
});
