import { useEffect, useState, type FormEvent } from 'react'
import { createVault, lockVault, unlockVault, vaultStatus } from './offline'
import { ErrorNotice, Loading } from './components'
import { errorMessage } from './logic'
import { sameDeviceIdentity } from './deviceContext'
import type { User } from './types'

export default function VaultPanel({ user, onChanged }: { user: User; onChanged?: () => void }) {
  const [status, setStatus] = useState<'missing' | 'locked' | 'unlocked' | 'loading'>('loading')
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [label, setLabel] = useState('My field notebook')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const refresh = async () => setStatus(await vaultStatus(user.id))
  useEffect(() => { refresh().catch(e => { setError(errorMessage(e)); setStatus('missing') }) }, [user.id])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      if (status === 'missing') {
        if (!consent || passphrase !== confirmation) throw new Error('Confirm the separate passphrase and device-storage consent.')
        await createVault(user, passphrase, label)
        setMessage('Encrypted vault created. Any earlier drafts for this account were migrated atomically; no pending work was discarded.')
      } else {
        const cached = await unlockVault(user.id, passphrase)
        if (!sameDeviceIdentity(cached, user)) {
          lockVault(user.id)
          throw new Error('This vault belongs to a different site context. Switch to its matching site to keep and sync those drafts; do not overwrite it.')
        }
        setMessage('Vault unlocked in this tab. The encryption key is held in memory, not saved on the device.')
      }
      setPassphrase(''); setConfirmation(''); await refresh(); onChanged?.()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="panel form-panel"><p className="eyebrow">ENCRYPTED DEVICE STORAGE / OPTIONAL</p><h2>Your field-notebook vault</h2>
    <p>Drafts and cached equipment are encrypted with AES-GCM and a separate device passphrase. The key exists only in this tab’s memory. Unlocking is not server sign-in and never authorizes approval or execution.</p>
    <p className="field-help">Use a trusted device and a unique passphrase of at least 12 characters—not your account password. There is no passphrase recovery. Losing it means unsynced encrypted drafts cannot be recovered. Vault labels and account IDs remain visible metadata.</p>
    {error && <ErrorNotice message={error} />}{message && <p className="notice success" role="status">{message}</p>}
    {status === 'loading' ? <Loading text="Checking device vault…" /> : status === 'unlocked' ? <div className="form-actions"><span>Unlocked for this account/site in this tab.</span><button className="button secondary" onClick={() => { lockVault(user.id); setStatus('locked'); setMessage('Vault locked. Encrypted drafts remain on this device.'); onChanged?.() }}>Lock device vault</button></div> : <form className="form-stack" onSubmit={submit}>
      {status === 'missing' && <label>Non-sensitive label for this device vault<input required maxLength={80} value={label} onChange={e => setLabel(e.target.value)} /></label>}
      <label>{status === 'missing' ? 'Create a separate device passphrase' : 'Device vault passphrase'}<input type="password" autoComplete={status === 'missing' ? 'new-password' : 'off'} minLength={status === 'missing' ? 12 : undefined} required value={passphrase} onChange={e => setPassphrase(e.target.value)} /></label>
      {status === 'missing' && <><label>Confirm device passphrase<input type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} />I trust this device and understand that the passphrase cannot be recovered. Migrate my earlier device drafts into this encrypted vault.</label></>}
      <button className="button secondary" disabled={busy}>{busy ? 'Protecting device records…' : status === 'missing' ? 'Create encrypted device vault' : 'Unlock device vault'}</button>
    </form>}
  </section>
}
