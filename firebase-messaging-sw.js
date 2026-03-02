// =========================================
// Firebase Cloud Messaging – Service Worker
// Håndterer push-varsler når appen er lukket
// =========================================

// Importer Firebase-biblioteker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase-konfigurasjon (må matche firebase-config.js)
firebase.initializeApp({
    apiKey: "AIzaSyAriK7G7aUKqOjGSA-InxqLWsqguy9cOdU",
    authDomain: "besteforeldre-appen.firebaseapp.com",
    projectId: "besteforeldre-appen",
    storageBucket: "besteforeldre-appen.firebasestorage.app",
    messagingSenderId: "299987046963",
    appId: "1:299987046963:web:068cc7b58485f1401d8946"
});

const messaging = firebase.messaging();

// ---- BACKGROUND MESSAGE HANDLER ----
// Kjører når appen er lukket eller i bakgrunnen
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM SW] Mottok bakgrunnsmelding:', payload);

    const data = payload.data || {};
    const notification = payload.notification || {};

    const title = notification.title || data.title || 'Daglig Helse';
    const options = {
        body: notification.body || data.body || 'Du har en ny påminnelse',
        icon: data.icon || './icons/icon-192.png',
        badge: './icons/icon-192.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: data.tag || 'daglig-helse-reminder',
        renotify: true,
        requireInteraction: true, // Viktig for eldre – varselet forsvinner ikke av seg selv
        actions: getActionsForType(data.type),
        data: {
            type: data.type || 'general',
            url: data.url || './index.html'
        }
    };

    return self.registration.showNotification(title, options);
});

// Bestem handlingsknapper basert på type
function getActionsForType(type) {
    switch (type) {
        case 'water':
            return [
                { action: 'open', title: '💧 Åpne appen' },
                { action: 'dismiss', title: 'OK' }
            ];
        case 'medicine':
            return [
                { action: 'open', title: '💊 Åpne appen' },
                { action: 'dismiss', title: 'OK' }
            ];
        case 'movement':
            return [
                { action: 'open', title: '🚶 Åpne appen' },
                { action: 'dismiss', title: 'OK' }
            ];
        default:
            return [
                { action: 'open', title: 'Åpne appen' }
            ];
    }
}

// ---- NOTIFICATION CLICK ----
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    // Åpne appen eller fokusereksisterende vindu
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Fokuser på eksisterende vindu
                for (const client of windowClients) {
                    if ('focus' in client) {
                        return client.focus();
                    }
                }
                // Åpne nytt vindu
                if (clients.openWindow) {
                    const url = event.notification.data?.url || './index.html';
                    return clients.openWindow(url);
                }
            })
    );
});
