import { useEffect, useState, type FormEvent } from 'react'
import { api } from './api'
import { Empty, ErrorNotice, Icon, Loading, PageHeading } from './components'
import { dateTime, errorMessage, isReviewer } from './logic'
import type { Asset, Observation, User } from './types'

export default function Assets({ assets, user, onCreated, onReport }: { assets: Asset[]; user: User; onCreated: (asset: Asset) => void; onReport: (assetId: string) => void }) {
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [observationAsset, setObservationAsset] = useState<Asset | null>(null)
  const canCreate = ['admin', 'supervisor'].includes(user.role)
  const canReport = ['admin', 'worker'].includes(user.role)
  const filtered = assets.filter(a => [a.code, a.name, a.area].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError('')
    try {
      const asset = await api.createAsset({ code: String(data.get('code')).trim(), name: String(data.get('name')).trim(), area: String(data.get('area')).trim(), criticality: data.get('criticality') as Asset['criticality'], manufacturer: String(data.get('manufacturer')).trim(), model: String(data.get('model')).trim() })
      onCreated(asset); form.reset(); setShowForm(false)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <><PageHeading eyebrow="SITE REFERENCE / ASSET REGISTER" title="Know the asset. Keep the context." description="Registered equipment gives every observation a traceable place in your operation." action={canCreate && <button className="button primary" onClick={() => setShowForm(!showForm)}><Icon name="plus" />{showForm ? 'Close asset form' : 'Register an asset'}</button>} />
    {showForm && <section className="panel form-panel"><div className="section-heading"><div><p className="eyebrow">NEW EQUIPMENT RECORD</p><h2>Register a real asset</h2></div></div><form onSubmit={create} className="form-grid"><label>Asset code<input name="code" required placeholder="e.g. PRS-04" maxLength={80} /></label><label>Asset name<input name="name" required placeholder="Equipment name" maxLength={160} /></label><label>Area / location<input name="area" required placeholder="Line, bay or production cell" maxLength={160} /></label><label>Criticality<select name="criticality" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Manufacturer <span className="optional">optional</span><input name="manufacturer" maxLength={160} /></label><label>Model <span className="optional">optional</span><input name="model" maxLength={160} /></label><div className="form-span">{error && <ErrorNotice message={error} />}<button className="button primary" disabled={busy}>{busy ? 'Registering…' : 'Save asset to register'}</button></div></form></section>}
    {isReviewer(user) && <section className="panel form-panel"><label>Externally supplied observation history<select value={observationAsset?.id || ''} onChange={e => setObservationAsset(assets.find(asset => asset.id === e.target.value) || null)}><option value="">Choose a registered asset</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</select></label>{observationAsset && <ObservationHistory key={observationAsset.id} asset={observationAsset} />}</section>}
    <section className="panel"><div className="section-heading"><h2>Equipment index <span className="count-label">{assets.length}</span></h2><span className="muted small-text">Code lookup uses registered assets only</span></div><label className="search-field asset-search"><span className="sr-only">Find asset by code, name or area</span><Icon name="search" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Enter an asset code, equipment name or area…" /></label>
      {filtered.length ? <div className="asset-grid">{filtered.map(a => <article className="asset-card" key={a.id}><div className="asset-card-top"><span className="asset-glyph"><Icon name="asset" size={28} /></span><span className={`priority priority-${a.criticality}`}>{a.criticality} criticality</span></div><p className="mono asset-code">{a.code}</p><h3>{a.name}</h3><p className="muted">{a.area}</p><dl className="asset-meta"><div><dt>Manufacturer</dt><dd>{a.manufacturer || 'Not recorded'}</dd></div><div><dt>Model</dt><dd>{a.model || 'Not recorded'}</dd></div><div><dt>Register status</dt><dd>{a.status}</dd></div></dl>{canReport && <button className="button secondary wide" onClick={() => onReport(a.id)}>Report an observation<Icon name="arrow" size={18} /></button>}</article>)}</div> : <Empty title={assets.length ? 'No registered asset matches.' : 'Give your equipment a place in the record.'}><p>{assets.length ? 'Check the code or search by area. Unknown codes never create an asset automatically.' : canCreate ? 'Register your first asset above. Workers can then attach observations to the correct equipment.' : 'Ask your administrator to register your site’s equipment before reporting.'}</p></Empty>}
    </section></>
}

function ObservationHistory({ asset }: { asset: Asset }) {
  const [items, setItems] = useState<Observation[] | null>(null)
  const [error, setError] = useState('')
  async function refresh() { try { setItems(await api.observations(asset.id)); setError('') } catch (e) { setError(errorMessage(e)) } }
  useEffect(() => { void refresh() }, [asset.id])
  return <div><div className="section-heading"><h3>{asset.code} / inbound observations</h3><button className="button secondary small" onClick={refresh}>Refresh history</button></div><p className="notice warning">External source statements are not independently verified truth. Use source context and site checks before drawing conclusions.</p>{error && <ErrorNotice message={error} />}{!items && !error && <Loading />}{items?.length === 0 && <Empty title="No inbound observations returned for this asset." />}{items?.map(item => <article className="notification-record" key={item.id}><p className="eyebrow">EXTERNALLY SUPPLIED / UNVERIFIED</p><h4>{item.external_id}</h4><p>Observed {dateTime(item.observed_at)} · source {item.integration_name || item.integration_id || 'not supplied'}{item.created_at ? ` · received ${dateTime(item.created_at)}` : ''}</p><pre className="measurement-record">{JSON.stringify(item.measurements, null, 2)}</pre></article>)}</div>
}
