import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('./api.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { api, ApiError, NetworkError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('a genuine transport failure is distinguishable from HTTP rejection', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(api.assets(), NetworkError)
  for (const status of [401, 403, 409, 422, 500]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Server rejected the request' }), { status })
    await assert.rejects(api.assets(), e => e instanceof ApiError && !(e instanceof NetworkError) && e.status === status)
  }
})
test('stale-version server messages remain visible, never converted to success', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: { message: 'Stale version; reload before retrying', current_version: 5 } }), { status: 409 })
  await assert.rejects(api.action('incident', { action: 'approve', version: 3 }), /Stale version; reload before retrying/)
})
test('manual create retries retain the supplied stable client id and cookie session', async () => {
  const received = []
  globalThis.fetch = async (url, options) => { received.push({ url, options }); return new Response(JSON.stringify({ id: 'confirmed' })) }
  const payload = { asset_id: 'asset', client_id: 'stable-client-id', description: 'Observed', impact: 'Stopped', injury_status: 'none', safe_state: 'isolated', measurements: '' }
  await api.createIncident(payload); await api.createIncident(payload)
  assert.deepEqual(received.map(r => JSON.parse(r.options.body).client_id), ['stable-client-id', 'stable-client-id'])
  assert.equal(received[0].url, '/api/v1/incidents')
  assert.equal(received[0].options.credentials, 'same-origin')
})

test('evidence uploads include the source record revision without forcing JSON content type', async () => {
  let received
  globalThis.fetch = async (_url, options) => { received = options; return new Response(JSON.stringify({ id: 'confirmed' })) }
  await api.upload('incident', new File(['test-only bytes'], 'proof.png', { type: 'image/png' }), 7)
  assert.ok(received.body instanceof FormData)
  assert.equal(received.body.get('version'), '7')
  assert.equal(received.body.get('file').name, 'proof.png')
  assert.equal(received.headers, undefined)
})

test('paged queue delegates full search, scope filter and pagination to server without local truncation', async () => {
  let received
  globalThis.fetch = async (url, options) => { received = { url, options }; return new Response(JSON.stringify({ items: [], total: 126, counts: { submitted: 100, resolved: 26 } })) }
  const page = await api.incidentPage({ limit: 25, offset: 50, search: 'press & 4% / fault', status: 'submitted', mine: true })
  const url = new URL(received.url, 'https://ops.example.test')
  assert.equal(url.pathname, '/api/v1/incidents/page')
  assert.equal(url.searchParams.get('search'), 'press & 4% / fault')
  assert.equal(url.searchParams.get('offset'), '50')
  assert.equal(url.searchParams.get('mine'), 'true')
  assert.equal(page.total, 126)
  assert.equal(page.counts.submitted, 100)
  assert.deepEqual(page.items, [])
})

test('MFA credentials and one-use reset tokens are request bodies, never URLs or role headers', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ user: { id: 'worker' } })) }
  await api.login('worker@example.test', 'private-password', '123456')
  await api.login('worker@example.test', 'private-password', undefined, 'one-use-recovery')
  await api.resetPassword('admin-issued-secret', 'replacement-password')
  assert.equal(calls[0].body.otp, '123456')
  assert.equal(calls[1].body.recovery_code, 'one-use-recovery')
  assert.equal(calls[1].body.otp, undefined)
  assert.deepEqual(calls[2].body, { token: 'admin-issued-secret', new_password: 'replacement-password' })
  for (const call of calls) {
    assert.equal(call.options.credentials, 'same-origin')
    assert.doesNotMatch(call.url, /private-password|admin-issued-secret|replacement-password|123456|one-use-recovery/)
    assert.equal(Object.keys(call.options.headers).some(key => /role|authorization/i.test(key)), false)
  }
})

test('release preserves selected method provenance and schedule submits an explicit timezone and note', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ id: 'incident', version: 9 })) }
  await api.action('incident', { action: 'approve', version: 7, note: 'Reviewed with independent evidence', review_confirmed: true, work_method_id: 'method-v2' })
  await api.action('incident', { action: 'schedule', version: 8, due_at: '2026-10-21T13:00:00.000Z', note: 'Next planned maintenance window' })
  assert.equal(calls[0].body.work_method_id, 'method-v2')
  assert.equal(calls[0].body.review_confirmed, true)
  assert.equal(calls[1].body.due_at, '2026-10-21T13:00:00.000Z')
  assert.equal(calls[1].body.note, 'Next planned maintenance window')
  assert.equal(calls[1].body.version, 8)
})

test('security and notification revocation errors remain failures without success fallback', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Not authorized for this record' }), { status: 403 })
  for (const action of [() => api.revokeSession('foreign-session'), () => api.updateUser('user', { active: false }), () => api.readNotification('foreign-notification'), () => api.revokeIntegration('foreign-source')]) {
    await assert.rejects(action(), e => e instanceof ApiError && e.status === 403)
  }
})

test('integration creation returns one-time secret independently of metadata refresh and observation read', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(options.method === 'POST' ? { id: 'source', name: 'Registered source', token: 'one-time-secret' } : [])) }
  assert.equal((await api.createIntegration('Registered source')).token, 'one-time-secret')
  assert.deepEqual(await api.integrations(), [])
  assert.deepEqual(await api.observations('asset / 4'), [])
  assert.equal(calls[2].url, '/api/v1/assets/asset%20%2F%204/observations')
  assert.equal(calls.some(call => call.url.includes('one-time-secret')), false)
})
