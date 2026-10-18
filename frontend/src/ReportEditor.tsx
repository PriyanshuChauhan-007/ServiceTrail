import { useCallback, useState, type FormEvent } from 'react'
import AssetScanner from './AssetScanner'
import VaultPanel from './VaultPanel'
import { api, NetworkError } from './api'
import { Empty, ErrorNotice, Icon, PageHeading, useUnsavedChanges } from './components'
import { errorMessage, sourceVersion } from './logic'
import { isVaultUnlocked, saveDraft, type OfflineDraft } from './offline'
import type { Asset, Incident, ReportInput, User } from './types'

interface Props {
  user: User
  assets: Asset[]
  assetId?: string
  incident?: Incident
  onSaved: (incident: Incident) => void
  onCancel: () => void
  onDraftSaved: () => void
  offlineConfirmed?: boolean
}

export default function ReportEditor({ user, assets, assetId, incident, onSaved, onCancel, onDraftSaved, offlineConfirmed = false }: Props) {
  const [input, setInput] = useState<ReportInput>(() => ({
    asset_id: incident?.asset_id || assetId || '',
    description: incident?.description || '',
    impact: incident?.impact || '',
    injury_status: incident?.injury_status || 'unknown',
    safe_state: incident?.safe_state || 'unknown',
    measurements: incident?.measurements || '',
    client_id: crypto.randomUUID(),
  }))
  const [lookup, setLookup] = useState('')
  const [error, setError] = useState('')
  const [failed, setFailed] = useState<ReportInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedOffline, setSavedOffline] = useState(false)
  const [, setVaultRevision] = useState(0)
  const onScanSelected = useCallback((selected: Asset) => {
    setInput(previous => ({ ...previous, asset_id: selected.id }))
    setLookup('')
    setFailed(null)
  }, [])
  const matches = assets.filter(a => [a.code, a.name, a.area].join(' ').toLowerCase().includes(lookup.trim().toLowerCase()))
  const asset = assets.find(a => a.id === input.asset_id) || incident?.asset
  const dirty = !savedOffline && (incident
    ? (['asset_id', 'description', 'impact', 'injury_status', 'safe_state', 'measurements'] as const).some(key => input[key] !== (incident[key] || ''))
    : Boolean(input.description || input.impact || input.measurements || input.injury_status !== 'unknown' || input.safe_state !== 'unknown'))

  useUnsavedChanges(dirty)

  function update<K extends keyof ReportInput>(field: K, value: ReportInput[K]) {
    setInput(old => ({ ...old, [field]: value }))
    setFailed(null)
  }
  function cancel() {
    if (dirty && !window.confirm('Leave this unsaved report? Its current form contents have not been saved on this device.')) return
    onCancel()
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (offlineConfirmed) { await storeOffline(input); return }
    setBusy(true); setError(''); setFailed(null)
    try {
      const { client_id: _clientId, ...report } = input
      const value = incident
        ? await api.reviseIncident(incident.id, { ...report, version: incident.version })
        : await api.createIncident(input)
      onSaved(value)
    } catch (e) {
      setError(errorMessage(e))
      if (!incident && e instanceof NetworkError) setFailed({ ...input })
    } finally { setBusy(false) }
  }
  async function storeOffline(source: ReportInput | null = failed) {
    if (!source) return
    if (!isVaultUnlocked(user.id)) { setError('Unlock or enroll your encrypted device vault in Account security before saving device drafts. Your form is still here.'); return }
    setBusy(true)
    try {
      const draft: OfflineDraft = { ...source, client_id: source.client_id!, user_id: user.id, created_at: new Date().toISOString() }
      await saveDraft(draft)
      setSavedOffline(true); setFailed(null); setError(''); onDraftSaved()
    } catch (e) { setError(`Device draft could not be saved: ${errorMessage(e)}`) }
    finally { setBusy(false) }
  }

  return <>
    {!incident && <PageHeading eyebrow={offlineConfirmed ? 'DEVICE CONTEXT / OFFLINE DRAFT' : 'FIELD NOTEBOOK / NEW OBSERVATION'} title="Tell the next person what you saw." description={offlineConfirmed ? 'This unlocked device context is not server-authorized sign-in. Save an encrypted draft only; server identity must be revalidated before submission.' : 'Record the source clearly. Unknowns are useful context—never replace them with a guess.'} />}
    {incident && <div className="notice info">
      <strong>Revise source version {sourceVersion(incident)} · record revision {incident.version}</strong>
      <p>Your source stays in the audit history. Saving creates a new report version and invalidates earlier analysis or approval. Evidence must be uploaded separately while the report is editable.</p>
    </div>}
    {assets.length === 0 && !incident ? <Empty title="An asset is needed before reporting.">
      <p>Ask your site administrator to register the equipment in the asset register.</p>
      <button className="button secondary" onClick={onCancel}>Return to workspace</button>
    </Empty> : <form onSubmit={submit} className="report-layout">
      <div className="report-fields">
        <fieldset className="report-fieldset" disabled={busy || savedOffline}>
          <legend className="sr-only">Source report fields</legend>
          <section className="panel form-panel">
            <div className="numbered-heading"><span>01</span><div><p className="eyebrow">THE EQUIPMENT</p><h2>Locate the asset</h2></div></div>
            {!busy && !savedOffline && <AssetScanner assets={assets} onSelected={onScanSelected} />}
            <label>Asset code or equipment search
              <input type="search" placeholder="Type the registered code, name or area" value={lookup} onChange={e => setLookup(e.target.value)} />
            </label>
            <label>Registered asset
              <select required value={input.asset_id} onChange={e => update('asset_id', e.target.value)}>
                <option value="">Select the observed asset</option>
                {matches.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name} / {a.area}</option>)}
                {input.asset_id && !matches.some(a => a.id === input.asset_id) && asset && <option value={asset.id}>{asset.code} · {asset.name}</option>}
              </select>
            </label>
            <p className="field-help">Use the exact registered code from the equipment label. A code lookup never invents an asset.</p>
          </section>
          <section className="panel form-panel">
            <div className="numbered-heading"><span>02</span><div><p className="eyebrow">THE SOURCE ACCOUNT</p><h2>Observation & impact</h2></div></div>
            <label>What did you observe?
              <textarea required maxLength={20000} rows={5} value={input.description} onChange={e => update('description', e.target.value)} placeholder="Describe what happened, where, and when. Include the sequence and alarm text you actually observed." />
            </label>
            <label>Production / operational impact
              <textarea required maxLength={10000} rows={3} value={input.impact} onChange={e => update('impact', e.target.value)} placeholder="Describe affected production, product, people or downtime. State unknown if not established." />
            </label>
            <label>Measurements & conditions <span className="optional">optional</span>
              <textarea maxLength={10000} rows={3} value={input.measurements} onChange={e => update('measurements', e.target.value)} placeholder="Observed value, unit, instrument and time—or explain why a measurement is unavailable." />
            </label>
            <p className="field-help">Measurements remain worker-reported observations, not verified sensor readings.</p>
          </section>
          <section className="panel form-panel">
            <div className="numbered-heading"><span>03</span><div><p className="eyebrow">IMMEDIATE SAFETY CONTEXT</p><h2>State what is known</h2></div></div>
            <div className="form-grid">
              <label>Injury status
                <select value={input.injury_status} onChange={e => update('injury_status', e.target.value as ReportInput['injury_status'])}>
                  <option value="unknown">Unknown / not established</option><option value="none">No injury reported</option><option value="reported">Injury reported</option>
                </select>
              </label>
              <label>Current equipment state
                <select value={input.safe_state} onChange={e => update('safe_state', e.target.value as ReportInput['safe_state'])}>
                  <option value="unknown">Unknown / not established</option><option value="isolated">Isolated</option><option value="stopped">Stopped, isolation not confirmed</option><option value="running">Running</option>
                </select>
              </label>
            </div>
            <p className="field-help">These are your statements, not a verified safety clearance. Follow your site’s emergency and isolation procedures.</p>
          </section>
        </fieldset>
        {error && <ErrorNotice message={error}>
          {failed && <div className="offline-offer">
            <p>No server confirmation was received. Save this attempted report in your encrypted device vault? Enrollment and unlock are required. Evidence is not stored offline.</p>
            <p>Retry and sync reuse the same client ID in case the original request reached the server. Check the returned source and revise it if needed.</p>
            <button type="button" className="button secondary" disabled={busy || !isVaultUnlocked(user.id)} onClick={() => storeOffline()}>Save attempted report as device draft</button>{!isVaultUnlocked(user.id) && <p className="field-help">Your vault is locked or not enrolled. Use the vault controls below; your report stays in this form.</p>}
          </div>}
        </ErrorNotice>}
        {savedOffline && <div className="notice success" role="status">
          <strong>Saved on this device. Awaiting server confirmation.</strong>
          <p>Open Device drafts and manually sync when the connection is restored. Keep the same draft to prevent duplicate submissions.</p>
          <button type="button" className="text-button" onClick={onCancel}>Return to workspace →</button>
        </div>}
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={cancel}>{savedOffline ? 'Return to workspace' : 'Cancel'}</button>
          <button className="button primary" disabled={busy || savedOffline}>{busy ? 'Saving…' : incident ? 'Save new report version' : offlineConfirmed ? 'Save encrypted device draft' : 'Submit source report'}<Icon name="arrow" /></button>
        </div>
      </div>
      <aside className="report-aside">
        <div className="notebook-card"><p className="eyebrow">YOUR FIELD RECORD</p><span className="notebook-rule" />
          <h3>{asset?.code || 'Select an asset'}</h3><p>{asset?.name || 'A traceable observation begins with the right equipment.'}</p>{asset && <p className="muted">{asset.area}</p>}
          <dl><div><dt>Reported by</dt><dd>{user.name}</dd></div><div><dt>Source</dt><dd>Worker observation</dd></div><div><dt>Evidence</dt><dd>Attach after submission</dd></div></dl>
        </div>
        <div className="aside-note"><h3>Useful over certain.</h3><p>Include what is missing. An honest “unknown” gives the reviewer a better starting point than an invented measurement.</p><p>Rule-based analysis flags gaps and suggests hypotheses. It does not diagnose the equipment.</p></div>
      </aside>
    </form>}
    {failed && !isVaultUnlocked(user.id) && <VaultPanel user={user} onChanged={() => setVaultRevision(value => value + 1)} />}
  </>
}
