import { useEffect, useState, type FormEvent } from 'react'
import { listVaults, unlockVault, type VaultInfo } from './offline'
import { Brand, Empty, ErrorNotice, Loading } from './components'
import { errorMessage } from './logic'
import type { User } from './types'

export default function OfflineAccess({ onUnlocked, onBack }: { onUnlocked: (user: User) => void; onBack: () => void }) {
  const [vaults, setVaults] = useState<VaultInfo[]>([])
  const [selected, setSelected] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { listVaults().then(items => { setVaults(items); setSelected(items[0]?.user_id ?? '') }).catch(e => setError(errorMessage(e))).finally(() => setLoading(false)) }, [])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const cached = await unlockVault(selected, passphrase); setPassphrase(''); onUnlocked(cached) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <main className="boot-screen"><Brand /><section className="panel form-panel offline-access-panel"><p className="eyebrow">OFFLINE DEVICE CONTEXT / NOT SERVER AUTHENTICATION</p><h1>Unlock your field notebook.</h1><p>Open encrypted drafts and registered equipment captured on this device. Cached identity may be stale or revoked. No approvals, work releases or execution writes are available without server authorization.</p>
    {error && <ErrorNotice message={error} />}
    {loading ? <Loading /> : !vaults.length ? <Empty title="No encrypted notebook on this device."><p>Create one in Account security while signed in online. Existing unencrypted drafts, if any, are retained for explicit migration by their owner.</p></Empty> : <form className="form-stack" onSubmit={submit}>
      <label>Device vault<select required value={selected} onChange={e => { setSelected(e.target.value); setPassphrase('') }}>{vaults.map(vault => <option key={vault.user_id} value={vault.user_id}>{vault.label}</option>)}</select></label>
      <label>Device passphrase<input type="password" autoComplete="off" required value={passphrase} onChange={e => setPassphrase(e.target.value)} /></label>
      <button className="button primary" disabled={busy}>{busy ? 'Unlocking encrypted notebook…' : 'Unlock drafts only'}</button>
    </form>}
    <button className="text-button" disabled={busy} onClick={onBack}>← Back to server connection</button>
  </section></main>
}
