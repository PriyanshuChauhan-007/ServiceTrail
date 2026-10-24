import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import ts from 'typescript'

const source = await readFile(new URL('./offline.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('import.meta.env.PROD', 'false')
const offline = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const originalFactory = globalThis.indexedDB
const originalRange = globalThis.IDBKeyRange
function reset() { globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange }
afterEach(() => { offline.lockVault('worker-a'); offline.lockVault('worker-b'); globalThis.indexedDB = originalFactory; globalThis.IDBKeyRange = originalRange })
const draft = (user, client = 'same-client-id') => ({ client_id: client, user_id: user, asset_id: 'registered-asset', description: 'A real worker observation', impact: 'Production stopped', injury_status: 'none', safe_state: 'stopped', measurements: '', created_at: '2026-10-19T08:00:00Z' })
const identity = id => ({ id, name: `Test ${id}`, email: `${id}@example.test`, role: 'worker', organization_id: 'test-org', site_id: 'test-site', organization_name: 'Test Organization', site_name: 'Test Plant' })
const PASSPHRASE = 'test-only device passphrase'
async function enroll(user) { await offline.createVault(identity(user), PASSPHRASE, `Test device ${user}`) }

test('device drafts use a compound account/client identity and never overwrite another account', async () => {
  reset()
  await enroll('worker-a'); await enroll('worker-b')
  await offline.saveDraft(draft('worker-a'))
  await offline.saveDraft({ ...draft('worker-b'), description: 'Another account’s observation' })
  assert.equal((await offline.listDrafts('worker-a'))[0].description, 'A real worker observation')
  assert.equal((await offline.listDrafts('worker-b'))[0].description, 'Another account’s observation')
  await offline.removeDraft('same-client-id', 'worker-a')
  assert.deepEqual(await offline.listDrafts('worker-a'), [])
  assert.equal((await offline.listDrafts('worker-b')).length, 1)
})

test('clear device records clears only the selected account and retains other pending work', async () => {
  reset()
  for (const user of ['worker-a', 'worker-b']) {
    await enroll(user)
    await offline.saveDraft(draft(user))
    await offline.cacheAssets(user, [{ id: `${user}-asset`, code: 'PRESS-01' }])
  }
  await offline.clearOfflineData('worker-a')
  assert.equal(await offline.vaultStatus('worker-a'), 'missing')
  await assert.rejects(offline.listDrafts('worker-a'), /locked/)
  await assert.rejects(offline.readCachedAssets('worker-a'), /locked/)
  assert.equal((await offline.listDrafts('worker-b')).length, 1)
  assert.deepEqual(await offline.readCachedAssets('worker-b'), [{ id: 'worker-b-asset', code: 'PRESS-01' }])
})

test('failed storage writes reject rather than claiming a saved draft and identifiers are required', async () => {
  reset()
  await enroll('worker-a')
  await assert.rejects(offline.saveDraft({ ...draft('worker-a'), user_id: '' }), /user_id/)
  await assert.rejects(offline.removeDraft('same-client-id', ''), /user_id/)
  await assert.rejects(offline.cacheAssets('worker-a', [() => 'not cloneable']))
  assert.deepEqual(await offline.readCachedAssets('worker-a'), [])
  globalThis.indexedDB = undefined
  await assert.rejects(offline.saveDraft(draft('worker-a')), /unavailable/)
})

test('only documented fields persist and saving again retains the idempotency key', async () => {
  reset()
  await enroll('worker-a')
  const original = { ...draft('worker-a'), unexpected_private_payload: 'do-not-persist' }
  await offline.saveDraft(original)
  await offline.saveDraft({ ...original, last_error: 'Server still unreachable' })
  const saved = await offline.listDrafts('worker-a')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].client_id, original.client_id)
  assert.equal(saved[0].last_error, 'Server still unreachable')
  assert.ok(!('unexpected_private_payload' in saved[0]))
})

async function rawRecords(storeName) {
  const db = await new Promise((resolve, reject) => { const req = indexedDB.open('servicetrail-device-v1', 2); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).getAll()
      tx.oncomplete = () => resolve(req.result)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

test('profiles, observations and equipment are ciphertext at rest, with fresh IVs and explicit locking', async () => {
  reset(); await enroll('worker-a')
  await offline.saveDraft(draft('worker-a'))
  const first = (await rawRecords('secure_records'))[0]
  await offline.saveDraft(draft('worker-a'))
  await offline.cacheAssets('worker-a', [{ id: 'asset', code: 'PRIVATE-EQUIPMENT-CODE' }])
  const records = await rawRecords('secure_records')
  const second = records.find(record => record.kind === 'draft')
  assert.notDeepEqual(first.iv, second.iv)
  for (const record of [...records, ...await rawRecords('vaults')]) {
    const serialized = JSON.stringify(record) + new TextDecoder().decode(record.ciphertext)
    for (const secret of [PASSPHRASE, 'A real worker observation', 'PRIVATE-EQUIPMENT-CODE', 'worker-a@example.test']) assert.ok(!serialized.includes(secret))
    assert.ok(record.ciphertext instanceof ArrayBuffer)
  }
  offline.lockVault('worker-a')
  assert.equal(await offline.vaultStatus('worker-a'), 'locked')
  await assert.rejects(offline.listDrafts('worker-a'), /locked/)
  await assert.rejects(offline.unlockVault('worker-a', 'incorrect passphrase'), /incorrect|damaged/)
  const cached = await offline.unlockVault('worker-a', PASSPHRASE)
  assert.equal(cached.id, 'worker-a')
  assert.equal((await offline.listDrafts('worker-a'))[0].description, 'A real worker observation')
  assert.equal((await offline.readCachedAssets('worker-a'))[0].code, 'PRIVATE-EQUIPMENT-CODE')
})

test('authenticated encryption rejects ciphertext copied into another account', async () => {
  reset(); await enroll('worker-a'); await enroll('worker-b')
  await offline.saveDraft(draft('worker-a'))
  const record = (await rawRecords('secure_records'))[0]
  const db = await new Promise(resolve => { const req = indexedDB.open('servicetrail-device-v1', 2); req.onsuccess = () => resolve(req.result) })
  await new Promise((resolve, reject) => { const tx = db.transaction('secure_records', 'readwrite'); tx.objectStore('secure_records').put({ ...record, user_id: 'worker-b' }); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error) })
  db.close()
  await assert.rejects(offline.listDrafts('worker-b'))
  assert.equal((await offline.listDrafts('worker-a')).length, 1)
})

test('baseline plaintext drafts migrate atomically on explicit vault enrollment without losing another user', async () => {
  reset()
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('servicetrail-device-v1', 1)
    req.onupgradeneeded = () => { const drafts = req.result.createObjectStore('drafts', { keyPath: ['user_id', 'client_id'] }); drafts.createIndex('by_user', 'user_id'); req.result.createObjectStore('assets', { keyPath: 'user_id' }) }
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts', 'assets'], 'readwrite')
    tx.objectStore('drafts').put(draft('worker-a')); tx.objectStore('drafts').put(draft('worker-b'))
    tx.objectStore('assets').put({ user_id: 'worker-a', assets: [{ id: 'legacy-asset', code: 'LEGACY-01' }] })
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error)
  })
  db.close()
  await enroll('worker-a')
  assert.equal((await offline.listDrafts('worker-a'))[0].client_id, 'same-client-id')
  assert.equal((await offline.readCachedAssets('worker-a'))[0].code, 'LEGACY-01')
  const remainingPlaintext = await rawRecords('drafts')
  assert.equal(remainingPlaintext.length, 1)
  assert.equal(remainingPlaintext[0].user_id, 'worker-b')
  await assert.rejects(enroll('worker-a'), /already exists/)
  assert.equal((await offline.listDrafts('worker-a')).length, 1)
})
