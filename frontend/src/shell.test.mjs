import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'))
  .replace('__OPSBRIDGE_SHELL_VERSION__', 'test-build')
  .replace('__OPSBRIDGE_SHELL_ASSETS__', JSON.stringify(['/index.html', '/assets/application.js', '/assets/application.css']))

function worker() {
  const listeners = new Map()
  const stores = new Map()
  let disconnected = false
  let requests = 0
  const caches = {
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)
      return { async put(path, response) { entries.set(path, response.clone()) }, async match(path) { return entries.get(path)?.clone() } }
    },
  }
  const fetch = async path => {
    requests++
    if (disconnected) throw new TypeError('Disconnected')
    const type = String(path).endsWith('.html') ? 'text/html' : String(path).endsWith('.css') ? 'text/css' : 'application/javascript'
    const response = new Response(`public-shell:${path}`, { headers: { 'content-type': type } })
    Object.defineProperty(response, 'url', { value: new URL(path, 'https://ops.example.test').href })
    return response
  }
  vm.runInNewContext(source, { self: { location: { origin: 'https://ops.example.test' }, addEventListener: (type, handler) => listeners.set(type, handler), clients: { claim: async () => undefined } }, caches, fetch, URL, Response, Set, Promise, Error })
  return {
    stores,
    get requests() { return requests },
    disconnect() { disconnected = true },
    async install() { let result; listeners.get('install')({ waitUntil: promise => { result = promise } }); await result },
    async request(path, method = 'GET', mode = 'cors') {
      let result
      listeners.get('fetch')({ request: { url: new URL(path, 'https://ops.example.test').href, method, mode }, respondWith: promise => { result = promise } })
      return result === undefined ? undefined : await result
    },
  }
}

test('the complete installed public shell reloads when disconnected', async () => {
  const sw = worker()
  await sw.install()
  assert.equal(sw.stores.get('opsbridge-shell-test-build').size, 3)
  sw.disconnect()
  assert.equal(await (await sw.request('/', 'GET', 'navigate')).text(), 'public-shell:/index.html')
  assert.equal(await (await sw.request('/assets/application.js')).text(), 'public-shell:/assets/application.js')
})

test('API, evidence, cross-origin requests and writes are never intercepted or cached', async () => {
  const sw = worker()
  await sw.install()
  const count = sw.requests
  for (const [path, method, mode] of [
    ['/api/v1/incidents', 'GET', 'cors'],
    ['/api/v1/incidents/id/evidence/file', 'GET', 'navigate'],
    ['/api/v1/incidents', 'POST', 'cors'],
    ['/assets/application.js?private=1', 'GET', 'cors'],
    ['https://another.example.test/assets/application.js', 'GET', 'cors'],
    ['/unregistered-private-route', 'GET', 'navigate'],
  ]) assert.equal(await sw.request(path, method, mode), undefined)
  assert.equal(sw.requests, count)
  assert.deepEqual([...sw.stores.get('opsbridge-shell-test-build').keys()].sort(), ['/assets/application.css', '/assets/application.js', '/index.html'])
})
