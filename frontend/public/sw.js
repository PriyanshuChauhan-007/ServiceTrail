/* Build replaces both markers with a content-addressed version and an exact shell allowlist.
 * This worker never reads IndexedDB, caches API/evidence, or queues mutations.
 */
const VERSION = '__SERVICETRAIL_SHELL_VERSION__'
const SHELL = __SERVICETRAIL_SHELL_ASSETS__
const PREFIX = 'servicetrail-shell-'
const CACHE = PREFIX + VERSION
const ALLOWED = new Set(SHELL)

function validShellResponse(response, path) {
  if (!response.ok || response.status !== 200 || response.redirected || response.type === 'opaque') return false
  const url = new URL(response.url)
  if (url.origin !== self.location.origin || url.pathname !== path || url.search) return false
  const type = response.headers.get('content-type') || ''
  if (path === '/index.html') return type.includes('text/html')
  if (path.endsWith('.js')) return /(?:javascript|ecmascript)/.test(type)
  if (path.endsWith('.css')) return type.includes('text/css')
  if (path.endsWith('.svg')) return type.includes('image/svg+xml')
  if (path.endsWith('.webmanifest')) return /(?:manifest\+json|application\/json)/.test(type)
  return !type.includes('text/html')
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    try {
      await Promise.all(SHELL.map(async path => {
        const response = await fetch(path, { credentials: 'omit', cache: 'reload', redirect: 'error' })
        if (!validShellResponse(response, path)) throw new Error(`Invalid shell resource: ${path}`)
        await cache.put(path, response)
      }))
    } catch (error) {
      await caches.delete(CACHE)
      throw error
    }
    // No skipWaiting: existing tabs retain the worker matching their loaded assets.
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const versions = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE)
    // Keep only one previous shell, plus this version. Never touch unrelated caches or drafts.
    await Promise.all(versions.slice(0, -1).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return
  // Only the static entry document is a navigation fallback; never turn an API error into HTML.
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const response = await fetch('/index.html', { credentials: 'omit', cache: 'no-cache', redirect: 'error' })
        if (!validShellResponse(response, '/index.html')) return response
        // Do not overwrite this version's HTML with a newer deployment's asset references.
        // HTML remains network-first; the original complete shell is the offline fallback.
        return response
      } catch {
        return (await cache.match('/index.html')) ?? Response.error()
      }
    })())
    return
  }
  if (!ALLOWED.has(url.pathname) || url.pathname === '/index.html') return
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(url.pathname)
    return cached ?? fetch(request)
  })())
})
