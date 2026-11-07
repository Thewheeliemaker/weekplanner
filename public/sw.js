// ── offline cache ──
// App shell: network-first for pages (so updates arrive right away), cache-first for hashed /assets files.
// Data is not cached here: the app keeps its own copy in localStorage.
const CACHE = 'wp-shell-v1'
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-192.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE)
  try {
    const resp = await fetch(request)
    if (resp.ok) cache.put(fallbackUrl || request, resp.clone())
    return resp
  } catch {
    return (await cache.match(fallbackUrl || request)) || Response.error()
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const resp = await fetch(request)
  if (resp.ok) cache.put(request, resp.clone())
  return resp
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  const refresh = fetch(request).then(resp => { if (resp.ok || resp.type === 'opaque') cache.put(request, resp.clone()); return resp }).catch(() => hit)
  return hit || refresh
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return
    if (req.mode === 'navigate') { event.respondWith(networkFirst(req, '/')); return }
    if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) { event.respondWith(cacheFirst(req)); return }
    return
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req))
  }
})

// ── push ──
self.addEventListener('push', (event) => {
  let data = { title: 'Weekplanner', body: 'Nieuw item toegevoegd' }
  try { data = event.data.json() } catch {}
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200]
  }
  if (data.tag) options.tag = data.tag
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Weekplanner', options),
      navigator.setAppBadge ? navigator.setAppBadge() : Promise.resolve()
    ])
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus()
      }
      return clients.openWindow('/')
    })
  )
})
