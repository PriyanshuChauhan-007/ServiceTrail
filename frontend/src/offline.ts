import type { User } from './types'

/** Encrypted, explicitly unlocked device context; NEVER server authentication.
 * Non-extractable keys exist only in this module's memory. No password, session
 * cookie, MFA seed, approval or verified incident is persisted in this vault.
 */
export interface OfflineDraft {
  client_id: string; user_id: string; asset_id: string; description: string
  impact: string; injury_status: string; safe_state: string; measurements: string
  created_at: string; last_error?: string
}
export interface VaultInfo { user_id: string; label: string; created_at: string }
interface Sealed { iv: number[]; ciphertext: ArrayBuffer }
interface VaultRecord extends VaultInfo, Sealed { vault_id: string; salt: number[] }
interface SecureRecord extends Sealed { user_id: string; kind: 'draft' | 'assets'; record_id: string }
interface Unlocked { key: CryptoKey; vault_id: string; user: User }
const DATABASE = 'servicetrail-device-v1'
const LEGACY_DRAFTS = 'drafts'
const LEGACY_ASSETS = 'assets'
const VAULTS = 'vaults'
const RECORDS = 'secure_records'
const ITERATIONS = 600_000
const unlocked = new Map<string, Unlocked>()
const encode = (value: string) => new TextEncoder().encode(value)
const aad = (user: string, kind: string, id: string) => encode(JSON.stringify(['servicetrail-v2', user, kind, id]))
let channel: BroadcastChannel | undefined

function requireId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new TypeError(`${field} must be a non-empty, unpadded identifier`)
}
function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Encrypted storage requires Web Crypto in a secure browser context (HTTPS or localhost).')
}
function deviceChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return undefined
  if (!channel) {
    channel = new BroadcastChannel('servicetrail-device-lock')
    channel.onmessage = event => { if (event.data?.type === 'lock' && typeof event.data.user_id === 'string') unlocked.delete(event.data.user_id) }
    window.addEventListener('pagehide', () => unlocked.clear())
  }
  return channel
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Device storage is unavailable in this browser')); return }
    const request = indexedDB.open(DATABASE, 2)
    let rejected = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(LEGACY_DRAFTS)) {
        const drafts = db.createObjectStore(LEGACY_DRAFTS, { keyPath: ['user_id', 'client_id'] })
        drafts.createIndex('by_user', 'user_id', { unique: false })
      }
      if (!db.objectStoreNames.contains(LEGACY_ASSETS)) db.createObjectStore(LEGACY_ASSETS, { keyPath: 'user_id' })
      if (!db.objectStoreNames.contains(VAULTS)) db.createObjectStore(VAULTS, { keyPath: 'user_id' })
      if (!db.objectStoreNames.contains(RECORDS)) {
        const records = db.createObjectStore(RECORDS, { keyPath: ['user_id', 'kind', 'record_id'] })
        records.createIndex('by_user', 'user_id')
        records.createIndex('by_kind', ['user_id', 'kind'])
      }
    }
    request.onerror = () => { rejected = true; reject(request.error ?? new Error('Cannot open device storage')) }
    request.onblocked = () => { rejected = true; reject(new Error('Device storage upgrade blocked. Close other ServiceTrail tabs and retry.')) }
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

/** Resolve after commit, not individual request success. Async crypto runs BEFORE transactions. */
async function transact<T>(stores: string[], mode: IDBTransactionMode, initial: T,
  perform: (tx: IDBTransaction, result: (value: T) => void, abort: (error: unknown) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction; let value = initial; let failure: unknown
    try { tx = db.transaction(stores, mode) } catch (error) { db.close(); reject(error); return }
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Device storage transaction aborted')) }
    tx.onerror = event => { failure ??= (event.target as IDBRequest | null)?.error ?? tx.error }
    const abort = (error: unknown) => { failure = error; tx.abort() }
    try { perform(tx, next => { value = next }, abort) } catch (error) { abort(error) }
  })
}
async function vaultRecord(user: string): Promise<VaultRecord | undefined> {
  return transact<VaultRecord | undefined>([VAULTS], 'readonly', undefined, (tx, result) => {
    const req = tx.objectStore(VAULTS).get(user); req.onsuccess = () => result(req.result)
  })
}
async function keyFor(passphrase: string, salt: number[]) {
  requireCrypto()
  const material = await crypto.subtle.importKey('raw', encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: ITERATIONS, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
async function seal(key: CryptoKey, user: string, kind: string, id: string, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(user, kind, id) }, key, encode(JSON.stringify(value)))
  return { iv: [...iv], ciphertext }
}
async function unseal<T>(key: CryptoKey, user: string, kind: string, id: string, value: Sealed): Promise<T> {
  const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv), additionalData: aad(user, kind, id) }, key, value.ciphertext)
  return JSON.parse(new TextDecoder().decode(text)) as T
}
function context(user: string): Unlocked {
  requireId(user, 'user_id')
  const value = unlocked.get(user)
  if (!value) throw new Error('Device vault is locked. Unlock it in Account security before accessing device records.')
  return value
}
function stillUnlocked(user: string, value: Unlocked) {
  if (unlocked.get(user) !== value) throw new Error('The device vault was locked before this operation completed. No device save is confirmed.')
}
export function lockVault(userId: string): void { unlocked.delete(userId); deviceChannel()?.postMessage({ type: 'lock', user_id: userId }) }
export function isVaultUnlocked(userId: string): boolean { return unlocked.has(userId) }
export async function vaultStatus(userId: string): Promise<'missing' | 'locked' | 'unlocked'> {
  requireId(userId, 'user_id')
  const record = await vaultRecord(userId)
  if (!record) { unlocked.delete(userId); return 'missing' }
  if (unlocked.get(userId)?.vault_id !== record.vault_id) { unlocked.delete(userId); return 'locked' }
  return 'unlocked'
}
export async function listVaults(): Promise<VaultInfo[]> {
  const records = await transact<VaultRecord[]>([VAULTS], 'readonly', [], (tx, result) => {
    const req = tx.objectStore(VAULTS).getAll(); req.onsuccess = () => result(req.result)
  })
  return records.map(({ user_id, label, created_at }) => ({ user_id, label, created_at }))
}

interface Legacy { drafts: OfflineDraft[]; assets: unknown[] }
async function legacyRecords(user: string): Promise<Legacy> {
  const value: Legacy = { drafts: [], assets: [] }
  return transact([LEGACY_DRAFTS, LEGACY_ASSETS], 'readonly', value, tx => {
    const drafts = tx.objectStore(LEGACY_DRAFTS).index('by_user').getAll(IDBKeyRange.only(user))
    const assets = tx.objectStore(LEGACY_ASSETS).get(user)
    drafts.onsuccess = () => { value.drafts = drafts.result }
    assets.onsuccess = () => { value.assets = assets.result?.assets ?? [] }
  })
}
function profile(user: User): User {
  requireId(user?.id, 'user_id'); requireId(user.organization_id, 'organization_id'); requireId(user.site_id, 'site_id')
  return { id: user.id, name: user.name, email: user.email, role: user.role, organization_id: user.organization_id, site_id: user.site_id,
    organization_name: user.organization_name, site_name: user.site_name, active: user.active,
    must_change_password: user.must_change_password, mfa_enabled: user.mfa_enabled }
}

export async function createVault(user: User, passphrase: string, label: string): Promise<void> {
  requireCrypto()
  const identity = profile(user)
  if (passphrase.length < 12 || !passphrase.trim()) throw new Error('Choose a separate device-vault passphrase of at least 12 characters.')
  if (!label.trim() || label.length > 80) throw new Error('Choose a non-sensitive device label of 1–80 characters.')
  if (await vaultRecord(user.id)) throw new Error('A vault already exists for this account. Unlock it; do not replace pending observations.')
  const legacy = await legacyRecords(user.id)
  const salt = [...crypto.getRandomValues(new Uint8Array(16))]
  const key = await keyFor(passphrase, salt)
  const vault_id = crypto.randomUUID()
  const record: VaultRecord = { user_id: user.id, vault_id, salt, label: label.trim(), created_at: new Date().toISOString(), ...await seal(key, user.id, 'profile', vault_id, identity) }
  const secured: SecureRecord[] = []
  for (const draft of legacy.drafts) secured.push({ user_id: user.id, kind: 'draft', record_id: draft.client_id, ...await seal(key, user.id, 'draft', draft.client_id, draft) })
  if (legacy.assets.length) secured.push({ user_id: user.id, kind: 'assets', record_id: 'register', ...await seal(key, user.id, 'assets', 'register', legacy.assets) })
  await transact([VAULTS, RECORDS, LEGACY_DRAFTS, LEGACY_ASSETS], 'readwrite', undefined, (tx, _result, abort) => {
    let pending = 3; let exists = false
    const current: Legacy = { drafts: [], assets: [] }
    const finish = () => {
      if (--pending) return
      if (exists) { abort(new Error('A vault was created in another tab. Unlock that vault instead.')); return }
      if (JSON.stringify(current) !== JSON.stringify(legacy)) { abort(new Error('Device drafts changed while enrolling. Retry; original drafts were retained.')); return }
      tx.objectStore(VAULTS).add(record)
      for (const entry of secured) tx.objectStore(RECORDS).put(entry)
      for (const draft of legacy.drafts) tx.objectStore(LEGACY_DRAFTS).delete([user.id, draft.client_id])
      tx.objectStore(LEGACY_ASSETS).delete(user.id)
    }
    const vault = tx.objectStore(VAULTS).get(user.id)
    const drafts = tx.objectStore(LEGACY_DRAFTS).index('by_user').getAll(IDBKeyRange.only(user.id))
    const assets = tx.objectStore(LEGACY_ASSETS).get(user.id)
    vault.onsuccess = () => { exists = !!vault.result; finish() }
    drafts.onsuccess = () => { current.drafts = drafts.result; finish() }
    assets.onsuccess = () => { current.assets = assets.result?.assets ?? []; finish() }
  })
  unlocked.set(user.id, { key, vault_id, user: identity }); deviceChannel()
}

export async function unlockVault(userId: string, passphrase: string): Promise<User> {
  requireId(userId, 'user_id'); requireCrypto()
  const record = await vaultRecord(userId)
  if (!record) throw new Error('No encrypted device vault exists for this account.')
  let identity: User; let key: CryptoKey
  try {
    key = await keyFor(passphrase, record.salt)
    identity = await unseal<User>(key, userId, 'profile', record.vault_id, record)
    if (identity.id !== userId || !identity.site_id || !identity.organization_id) throw new Error('Invalid identity context')
  } catch { throw new Error('Vault could not be unlocked. The passphrase is incorrect or the encrypted record is damaged. No drafts were removed.') }
  unlocked.set(userId, { key, vault_id: record.vault_id, user: identity }); deviceChannel()
  return identity
}

export async function saveDraft(draft: OfflineDraft): Promise<void> {
  requireId(draft?.user_id, 'user_id'); requireId(draft.client_id, 'client_id'); requireId(draft.asset_id, 'asset_id')
  for (const field of ['description', 'impact', 'injury_status', 'safe_state', 'measurements', 'created_at'] as const) {
    if (typeof draft[field] !== 'string') throw new TypeError(`${field} must be text`)
  }
  if (!Number.isFinite(Date.parse(draft.created_at))) throw new TypeError('created_at must be a valid date')
  if (draft.last_error !== undefined && typeof draft.last_error !== 'string') throw new TypeError('last_error must be text')
  const ctx = context(draft.user_id)
  const value: OfflineDraft = { user_id: draft.user_id, client_id: draft.client_id, asset_id: draft.asset_id, description: draft.description,
    impact: draft.impact, injury_status: draft.injury_status, safe_state: draft.safe_state, measurements: draft.measurements, created_at: draft.created_at,
    ...(draft.last_error === undefined ? {} : { last_error: draft.last_error }) }
  const record: SecureRecord = { user_id: draft.user_id, kind: 'draft', record_id: draft.client_id, ...await seal(ctx.key, draft.user_id, 'draft', draft.client_id, value) }
  stillUnlocked(draft.user_id, ctx)
  await transact([RECORDS], 'readwrite', undefined, tx => { stillUnlocked(draft.user_id, ctx); tx.objectStore(RECORDS).put(record) })
}

export async function listDrafts(userId: string): Promise<OfflineDraft[]> {
  const ctx = context(userId)
  const records = await transact<SecureRecord[]>([RECORDS], 'readonly', [], (tx, result) => {
    const req = tx.objectStore(RECORDS).index('by_kind').getAll(IDBKeyRange.only([userId, 'draft'])); req.onsuccess = () => result(req.result)
  })
  const drafts = await Promise.all(records.map(async record => {
    const value = await unseal<OfflineDraft>(ctx.key, userId, 'draft', record.record_id, record)
    if (value.user_id !== userId || value.client_id !== record.record_id) throw new Error('Encrypted draft ownership mismatch')
    return value
  }))
  stillUnlocked(userId, ctx)
  return drafts.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.client_id.localeCompare(b.client_id))
}

export async function removeDraft(clientId: string, userId: string): Promise<void> {
  requireId(clientId, 'client_id'); const ctx = context(userId)
  await transact([RECORDS], 'readwrite', undefined, tx => { stillUnlocked(userId, ctx); tx.objectStore(RECORDS).delete([userId, 'draft', clientId]) })
}

export async function cacheAssets(userId: string, assets: unknown[]): Promise<void> {
  if (!Array.isArray(assets)) throw new TypeError('assets must be an array')
  const ctx = context(userId)
  const value = structuredClone(assets)
  const record: SecureRecord = { user_id: userId, kind: 'assets', record_id: 'register', ...await seal(ctx.key, userId, 'assets', 'register', value) }
  stillUnlocked(userId, ctx)
  await transact([RECORDS], 'readwrite', undefined, tx => { stillUnlocked(userId, ctx); tx.objectStore(RECORDS).put(record) })
}
export async function readCachedAssets(userId: string): Promise<unknown[]> {
  const ctx = context(userId)
  const record = await transact<SecureRecord | undefined>([RECORDS], 'readonly', undefined, (tx, result) => {
    const req = tx.objectStore(RECORDS).get([userId, 'assets', 'register']); req.onsuccess = () => result(req.result)
  })
  if (!record) { stillUnlocked(userId, ctx); return [] }
  const value = await unseal<unknown[]>(ctx.key, userId, 'assets', 'register', record)
  stillUnlocked(userId, ctx)
  if (!Array.isArray(value)) throw new Error('Encrypted asset register has an invalid format')
  return value
}

export async function clearOfflineData(userId: string): Promise<void> {
  requireId(userId, 'user_id')
  lockVault(userId)
  await transact([VAULTS, RECORDS, LEGACY_DRAFTS, LEGACY_ASSETS], 'readwrite', undefined, tx => {
    tx.objectStore(VAULTS).delete(userId)
    tx.objectStore(LEGACY_ASSETS).delete(userId)
    for (const name of [RECORDS, LEGACY_DRAFTS]) {
      const req = tx.objectStore(name).index('by_user').openCursor(IDBKeyRange.only(userId))
      req.onsuccess = () => { if (req.result) { req.result.delete(); req.result.continue() } }
    }
  })
}

export function registerOfflineShell(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(error => {
    console.error('ServiceTrail offline shell registration failed', error)
  })
}
