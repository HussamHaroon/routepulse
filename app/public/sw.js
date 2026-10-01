// Routepulse service worker.
// cache-first for same-origin GET static assets; network-first for /api/*
// (cache only as an offline fallback); never intercept non-GET requests.
// Everything is try/catch'd — a cache or network failure must never break
// the page it stands in front of.

const CACHE = 'routepulse-v1'

self.addEventListener('install', () => {
  try {
    self.skipWaiting()
  } catch {
    /* older browsers */
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        await self.clients.claim()
      } catch {
        /* cleanup is best-effort */
      }
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  try {
    if (req.method !== 'GET') return // never cache/answer non-GET from the SW
    const url = new URL(req.url)
    if (url.origin !== self.location.origin) return // cross-origin: pass through untouched

    event.respondWith(
      (async () => {
        try {
          if (url.pathname.startsWith('/api/')) {
            // network-first: live data wins; cache only rescues offline reloads
            try {
              const fresh = await fetch(req)
              if (fresh && fresh.ok) {
                const cache = await caches.open(CACHE)
                try {
                  cache.put(req, fresh.clone())
                } catch {
                  /* opaque/undiscardable body — skip caching */
                }
              }
              return fresh
            } catch {
              const cached = await caches.match(req)
              if (cached) return cached
              throw new Error('offline and not cached')
            }
          }

          // cache-first static
          const cached = await caches.match(req)
          if (cached) return cached
          const fresh = await fetch(req)
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE)
            try {
              cache.put(req, fresh.clone())
            } catch {
              /* skip caching on failure */
            }
          }
          return fresh
        } catch {
          return new Response('', { status: 504, statusText: 'offline' })
        }
      })()
    )
  } catch {
    /* malformed request bookkeeping — let the browser handle it */
  }
})
