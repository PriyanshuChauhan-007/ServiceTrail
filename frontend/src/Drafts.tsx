import { useEffect, useState } from 'react'
import { api } from './api'
import { clearOfflineData, isVaultUnlocked, listDrafts, removeDraft, saveDraft, type OfflineDraft } from './offline'
import VaultPanel from './VaultPanel'
import { Empty, ErrorNotice, Icon, Loading, PageHeading } from './components'
import { dateTime, errorMessage } from './logic'
import { sameDeviceIdentity } from './deviceContext'
import type { Asset, Incident, ReportInput, User } from './types'

interface Props { user: User; assets: Asset[]; onSynced: (incident: Incident) => void; onChanged: () => void; offlineOnly?: boolean }
export default function Drafts(props: Props) {
  const [revision, setRevision] = useState(0)
  if (!isVaultUnlocked(props.user.id)) return <><PageHeading eyebrow="DEVICE STORAGE / LOCKED VAULT" title="Unlock your encrypted field records." description="Draft counts and cached content are unavailable while locked. Unlocking a vault does not sign in to the server." /><VaultPanel user={props.user} onChanged={() => { setRevision(v => v + 1); props.onChanged() }} /></>
  return <UnlockedDrafts key={revision} {...props} />
}

function UnlockedDrafts({ user, assets, onSynced, onChanged, offlineOnly = false }: Props) {
  const [drafts, setDrafts] = useState<OfflineDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clearConfirmed, setClearConfirmed] = useState(false)
  const [deleteId, setDeleteId] = useState('')
  const refresh = async () => { setDrafts(await listDrafts(user.id)); setLoadFailed(false) }
  useEffect(() => { let active = true; listDrafts(user.id).then(values => { if (active) setDrafts(values) }).catch(e => { if (active) { setError(errorMessage(e)); setLoadFailed(true) } }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [user.id])
  async function sync(draft: OfflineDraft) {
    if (offlineOnly) { setError('Revalidate the same server identity before syncing device work.'); return }
    if (!assets.some(asset => asset.id === draft.asset_id)) { setError('This draft asset is not in the current site register. Switch to its original server site before syncing.'); return }
    setBusy(draft.client_id); setError(''); setSuccess('')
    let receipt: Incident | null = null
    try {
      const live = (await api.me()).user
      if (!sameDeviceIdentity(user, live)) throw new Error('The live server account or site differs from this device context. Sign in to the matching account and site before syncing.')
      if (live.must_change_password) throw new Error('Complete the required password change in Account security before syncing.')
      const input: ReportInput = { asset_id: draft.asset_id, description: draft.description, impact: draft.impact, injury_status: draft.injury_status as ReportInput['injury_status'], safe_state: draft.safe_state as ReportInput['safe_state'], measurements: draft.measurements, client_id: draft.client_id }
      receipt = await api.createIncident(input)
      onSynced(receipt)
      await removeDraft(draft.client_id, user.id)
      await refresh(); onChanged(); setSuccess(`${receipt.number} confirmed by the server. Its device draft was removed. Attach evidence from the incident’s Source & evidence section.`)
    } catch (e) {
      const message = errorMessage(e)
      setError(receipt ? `${receipt.number} was received, but device cleanup failed. The stable client ID is retained; retrying will not intentionally create another report. ${message}` : `Draft not synced: ${message}`)
      try { await saveDraft({ ...draft, last_error: message }); await refresh() } catch { /* Preserve the original draft and visible failure. */ }
    } finally { setBusy(null) }
  }
  async function discard(id: string) {
    setBusy(id); setError('')
    try { await removeDraft(id, user.id); await refresh(); setDeleteId(''); onChanged(); setSuccess('Selected device draft deleted. No server record was changed.') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }
  async function clear() {
    if (!clearConfirmed) return
    setBusy('clear'); setError('')
    try { await clearOfflineData(user.id); setDrafts([]); setClearConfirmed(false); onChanged(); setSuccess('Your device drafts and cached assets were cleared. Server records were unaffected.') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }
  return <>
    <PageHeading eyebrow="DEVICE STORAGE / EXPLICIT MANUAL SYNC" title="Keep the observation. Own the handoff." description="Encrypted account-scoped copies on this device. They await confirmed server receipt and are never submitted automatically." />
    <div className="notice info"><strong>{offlineOnly ? 'Device context only — server sign-in is not confirmed.' : 'Offline capture is only a draft.'}</strong><p>Capture is available after genuine network failure and vault unlock. Sync requires revalidated server identity. The original client ID is reused to avoid duplicate creates. Evidence, approvals, checklist steps and verification are online-only.</p></div>
    {error && <ErrorNotice message={error}>{loadFailed && <><p>Your draft count is unknown. No device records were discarded.</p><button className="text-button" onClick={async () => { try { await refresh(); setError('') } catch (e) { setError(errorMessage(e)) } }}>Retry reading device storage →</button></>}</ErrorNotice>}
    {success && <p className="notice success" role="status">{success}</p>}
    {loading ? <Loading text="Reading your encrypted device drafts…" /> : !loadFailed && <section className="panel"><div className="section-heading"><div><p className="eyebrow">UNSUBMITTED SOURCE RECORDS</p><h2>Device drafts <span className="count-label">{drafts.length}</span></h2></div></div>
      {drafts.length ? <div className="draft-list">{drafts.map(draft => <article key={draft.client_id} className="draft-card">
        <div className="draft-heading"><span className="mono">{assets.find(asset => asset.id === draft.asset_id)?.code || 'Asset not in current site register'}</span><span className="badge draft-badge">Awaiting sync</span></div>
        <h3>{draft.description}</h3><p>{draft.impact}</p>
        <dl className="draft-facts"><div><dt>Saved</dt><dd>{dateTime(draft.created_at)}</dd></div><div><dt>Injury statement</dt><dd>{draft.injury_status}</dd></div><div><dt>Equipment state</dt><dd>{draft.safe_state}</dd></div></dl>
        {draft.measurements && <p className="preserve-lines"><strong>Measurements: </strong>{draft.measurements}</p>}<p className="field-help mono">Client ID · {draft.client_id}</p>
        {draft.last_error && <p className="notice warning">Last sync error: {draft.last_error}</p>}
        <div className="form-actions"><button className="button danger small" onClick={() => setDeleteId(deleteId === draft.client_id ? '' : draft.client_id)} disabled={!!busy}>Delete draft…</button>{!offlineOnly && <button className="button primary" disabled={!!busy || !assets.some(asset => asset.id === draft.asset_id)} onClick={() => sync(draft)}>{busy === draft.client_id ? 'Syncing…' : 'Manually sync this draft'}<Icon name="arrow" size={18} /></button>}</div>
        {!offlineOnly && !assets.some(asset => asset.id === draft.asset_id) && <p className="field-help">Reconnect to this draft’s registered asset site before syncing.</p>}
        {deleteId === draft.client_id && <div className="notice warning"><strong>Delete this device observation?</strong><p>This permanently removes the device copy. A previous unconfirmed submission may already exist on the server. Deleting a draft never deletes server reports.</p><button className="button danger small" disabled={!!busy} onClick={() => discard(draft.client_id)}>Confirm deletion</button><button className="button ghost small" onClick={() => setDeleteId('')}>Keep draft</button></div>}
      </article>)}</div> : <Empty title="No device drafts returned."><p>Drafts appear after explicit encrypted device saves. No server reports are copied into this list.</p></Empty>}
    </section>}
    <section className="panel storage-panel"><p className="eyebrow">SHARED DEVICE HYGIENE</p><h3>Clear your local records</h3><p className="muted">Removes your unsynced drafts and cached assets on this device. Server reports and other users’ device records are unaffected.</p><label className="checkbox-label"><input type="checkbox" checked={clearConfirmed} onChange={e => setClearConfirmed(e.target.checked)} />I understand any unsynced drafts will be permanently deleted.</label><button className="button danger" disabled={!clearConfirmed || !!busy} onClick={clear}>Clear my device data</button></section>
  </>
}
