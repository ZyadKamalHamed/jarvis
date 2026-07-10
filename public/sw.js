// JARVIS service worker. Network first with cache fallback for the shell,
// and two hard rules that protect stealth and storage:
//   1. /api/* and /aios* are NEVER cached: no data payload, career or
//      otherwise, may persist in Cache Storage where devtools could show it.
//   2. Audio is never cached (boot track and music are big and local anyway).
const CACHE = 'jarvis-shell-v1'
const SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/aios')) return
  if (/\.(mp3|m4a|wav|aac|ogg|aiff)$/i.test(url.pathname)) return
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.pathname === '/' }))
  )
})
