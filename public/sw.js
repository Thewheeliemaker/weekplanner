self.addEventListener('push', (event) => {
  let data = { title: 'Weekplanner', body: 'Nieuw item toegevoegd' }
  try { data = event.data.json() } catch {}
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Weekplanner', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200]
      }),
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
