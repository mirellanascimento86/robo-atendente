const CACHE_NAME = 'whatsapp-panel-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

// Instalar e cachear recursos estáticos
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Ativar e limpar caches antigos
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Estratégia: Network First, fallback para Cache
self.addEventListener('fetch', (e) => {
    // Ignorar requisições do Supabase (são handleadas pelo app)
    if (e.request.url.includes('supabase.co')) {
        return;
    }
    
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // Atualizar cache se for sucesso
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback para cache
                return caches.match(e.request).then((cached) => {
                    return cached || new Response('Offline');
                });
            })
    );
});

// Background sync para mensagens pendentes
self.addEventListener('sync', (e) => {
    if (e.tag === 'sync-messages') {
        e.waitUntil(syncMessages());
    }
});

async function syncMessages() {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ type: 'SYNC_MESSAGES' });
    });
}
