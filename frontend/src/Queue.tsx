import { useEffect, useState } from 'react'
import { api } from './api'
import type { IncidentPage, User } from './types'
import { Badge, Empty, ErrorNotice, Icon, Loading, PageHeading } from './components'
import { errorMessage, isReviewer, nextStep, shortDate, statusLabels } from './logic'

export default function Queue({ user, onOpen, onReport, revision = 0 }: { user: User; onOpen: (id: string) => void; onReport: () => void; revision?: number }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [mine, setMine] = useState(false)
  const reviewer = isReviewer(user)
  const [page, setPage] = useState<IncidentPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [refreshing, setRefreshing] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; setRefreshing(true); const timer = setTimeout(() => { api.incidentPage({ limit: 25, offset, search: search.trim(), status: status === 'all' ? '' : status, mine }).then(value => { if (active) { setPage(value); setError('') } }).catch(e => { if (active) { setPage(null); setError(errorMessage(e)) } }).finally(() => { if (active) setRefreshing(false) }) }, 250); return () => { active = false; clearTimeout(timer) } }, [offset, search, status, mine, reload, revision, user.site_id])
  const items = page?.items || []
  const sum = (statuses: string[]) => page ? statuses.reduce((total, key) => total + (page.counts[key] || 0), 0).toString().padStart(2, '0') : '—'
  const active = page ? Object.entries(page.counts).filter(([key]) => Object.hasOwn(statusLabels, key) && !['resolved', 'cancelled'].includes(key)).reduce((total, [, count]) => total + count, 0).toString().padStart(2, '0') : '—'
  const attention = sum(reviewer ? ['submitted', 'ready_for_review', 'under_review', 'reopened'] : ['needs_clarification', 'changes_requested'])
  const released = sum(['approved', 'in_progress'])
  const verification = sum(['awaiting_verification'])
  const resetFilters = () => { setStatus('all'); setSearch(''); setMine(false); setOffset(0) }
  return <>
    <PageHeading eyebrow={reviewer ? 'OPERATIONS DESK / LIVE WORK REGISTER' : 'FIELD NOTEBOOK / YOUR SHIFT'} title={reviewer ? 'Every report. A clear next step.' : 'The work in front of you.'} description={reviewer ? 'Read the source. Question the gaps. Release work with an accountable decision.' : 'Capture what you observe, clarify what is missing, and carry out released work.'} action={(user.role === 'worker' || user.role === 'admin') && <button className="button primary" onClick={onReport}><Icon name="plus" />New field report</button>} />
    <section className="register-stats" aria-label="Current incident counts">
      <div className="register-stat"><span>Open reports</span><strong>{active}</strong><small>Across your server-scoped queue</small></div>
      <div className="register-stat"><span>{reviewer ? 'Review attention' : 'Needs your context'}</span><strong className="amber-text">{attention}</strong><small>{reviewer ? 'Submitted, in review or reopened' : 'Clarification or revision requested'}</small></div>
      <div className="register-stat"><span>Released work</span><strong>{released}</strong><small>Approved or in progress</small></div>
      <div className="register-stat"><span>Verification handoffs</span><strong>{verification}</strong><small>Execution awaiting engineer review</small></div>
    </section>
    <section className="panel queue-panel"><div className="section-heading"><div><p className="eyebrow">THE WORK REGISTER</p><h2>{reviewer ? 'Site incident queue' : 'Reports & assigned work'}</h2></div><button className="button ghost small" onClick={() => setReload(v => v + 1)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh register'}</button></div>
      <div className="queue-filters"><label className="search-field"><span className="sr-only">Search reports by number, asset or observation</span><Icon name="search" /><input type="search" maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setOffset(0) }} placeholder="Search all server-scoped reports…" /></label><label><span className="sr-only">Filter by status</span><select value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{reviewer && <label className="checkbox-label"><input type="checkbox" checked={mine} onChange={e => { setMine(e.target.checked); setOffset(0) }} />My reports / assignments</label>}</div>
      <div className="register-caption"><span>{page ? `${page.total} matching records · ${offset + (items.length ? 1 : 0)}–${offset + items.length}` : 'Counts await server confirmation'}</span><span>Newest reports first · 25 per page</span></div>
      {error && <ErrorNotice message={error} />}{refreshing ? <Loading text="Searching the server register…" /> : page && (items.length === 0 ? <Empty title="No reports match this view."><p>Register real assets and report observations, or reset the filters.</p><button className="text-button" onClick={resetFilters}>Reset filters</button></Empty> : <div className="incident-list">{items.map(item => <button className="incident-card" key={item.id} onClick={() => onOpen(item.id)}>
        <div className="incident-code"><span className="mono">{item.number}</span><span className={`priority priority-${item.priority}`}>{item.priority}</span><span className="card-date">{shortDate(item.updated_at)}</span></div>
        <div className="incident-card-main"><div><p className="asset-eyebrow">{item.asset?.code || 'Asset unavailable'} <span>/ {item.asset?.area}</span></p><h3>{item.description}</h3></div><Badge status={item.status} /></div>
        <div className="incident-card-foot"><span>{nextStep(item)}</span><span>{item.assigned_to ? `Assigned · ${item.assigned_to.name}` : `Reported · ${item.reporter.name}`}<Icon name="arrow" size={18} /></span></div>
      </button>)}</div>)}
      {page && <div className="form-actions"><button className="button secondary" disabled={refreshing || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 25))}>Previous 25</button><button className="button secondary" disabled={refreshing || offset + items.length >= page.total} onClick={() => setOffset(v => v + 25)}>Next 25</button></div>}
    </section><p className="quiet-note">A report is an observation, not a diagnosis. Rule-based analysis helps identify gaps; people remain accountable for decisions.</p>
  </>
}
