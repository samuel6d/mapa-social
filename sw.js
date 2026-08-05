const CACHE = 'mapa-social-v1'
const ASSETS = [
  '/mapa-social/',
  '/mapa-social/index.html',
  '/mapa-social/static/js/config.js',
  '/mapa-social/static/js/auth.js',
  '/mapa-social/static/js/mapa.js',
  '/mapa-social/static/js/posts.js',
  '/mapa-social/static/js/chat.js',
  '/mapa-social/icons/icon-192.png',
]

// instala e cacheia os assets principais
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  )
  self.skipWaiting()
})

// limpa caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// serve do cache, busca na rede se não tiver
self.addEventListener('fetch', e => {
  // não cacheia requisições ao servidor Flask ou Supabase
  if (e.request.url.includes('railway.app') ||
      e.request.url.includes('supabase.co') ||
      e.request.url.includes('microlink.io')) {
    return
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  )
})