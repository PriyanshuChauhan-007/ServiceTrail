import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { Analysis, BridgeStatus, Checklist, HistoryEntry, ParsedEvent, Scenario } from './types'

const OPERATOR_NAME = 'Priyanshu'
const OPERATOR_ROLE = 'Industrial response operator'

const localScenarios: Scenario[] = [
  { id: 'cnc_press_breakdown', name: 'CNC press line breakdown', category: 'industrial', description: 'A hydraulic stamping press has stopped mid-run in Bay 3.', criticality: 'critical', tags: ['maintenance', 'hydraulic', 'production'], sample_reports: ['Machine 4 ka motor overheat ho raha hai, production ruk gaya hai.'] },
  { id: 'water_main_break', name: 'Municipal water main break', category: 'civic', description: 'A water main failure affects traffic and nearby residents.', criticality: 'high', tags: ['public-works', 'water', 'traffic'], sample_reports: ['School ke paas road par paani bhar gaya hai, traffic jam ho raha hai.'] },
  { id: 'cold_chain_dispatch', name: 'Cold-chain dispatch interruption', category: 'logistics', description: 'A refrigerated route is delayed and product quality is at risk.', criticality: 'high', tags: ['warehouse', 'reefer', 'quality'], sample_reports: ['Truck late hai aur shipment temperature limit cross kar rahi hai.'] },
]

const scenarioMeta: Record<string, { event: string; asset: string; location: string; symptoms: string[]; actions: string[]; checklist: string[] }> = {
  cnc_press_breakdown: { event: 'equipment_breakdown', asset: 'MACHINE-04', location: 'Bay 3 / Production Cell A', symptoms: ['motor overheating', 'asset stopped'], actions: ['Stop the affected cell and verify zero energy before inspection.', 'Capture alarm codes and inspect for visible damage.', 'Have a qualified lead verify the repair before a guarded test cycle.'], checklist: ['Stop the machine and verify zero-energy state.', 'Record alarm code, visible damage, and temperature.', 'Brief the shift lead before a guarded test cycle.'] },
  water_main_break: { event: 'public_utility_failure', asset: 'WATER-MAIN-05', location: 'School Road / Sector 5', symptoms: ['water leak', 'traffic obstruction'], actions: ['Secure the affected road edge and keep people clear of standing water.', 'Notify the water response crew and traffic control.', 'Confirm isolation and communicate the public impact.'], checklist: ['Set a safe perimeter and route traffic away.', 'Notify water response and traffic control.', 'Confirm isolation and publish an impact update.'] },
  cold_chain_dispatch: { event: 'logistics_interruption', asset: 'REEFER-12', location: 'North distribution route', symptoms: ['route delay', 'temperature excursion'], actions: ['Hold the shipment and verify product temperature against limits.', 'Escalate to the cold-chain lead and identify a recovery route.', 'Record disposition before releasing or scrapping product.'], checklist: ['Hold shipment and capture current temperature.', 'Escalate to the cold-chain lead.', 'Record disposition and recovery route.'] },
}

const metaFor = (id: string) => scenarioMeta[id] ?? scenarioMeta.cnc_press_breakdown
const localParse = (text: string, id: string): ParsedEvent => {
  const meta = metaFor(id)
  return { bridge_id: `bridge_demo_${Date.now()}`, scenario_id: id, source_text: text, event_type: meta.event, asset_id: meta.asset, machine: id === 'cnc_press_breakdown' ? meta.asset : null, location: meta.location, symptoms: meta.symptoms, severity: id === 'cnc_press_breakdown' ? 'critical' : 'high', safety_flags: ['controlled response required'], downtime_minutes: id === 'cold_chain_dispatch' ? null : 42, quantities: id === 'cold_chain_dispatch' ? { pallets: 24 } : {}, extracted_keywords: ['incident', 'response'], confidence: .92 }
}
const localAnalyze = (p: ParsedEvent): Analysis => {
  const m = metaFor(p.scenario_id)
  return { analysis_id: `analysis_demo_${Date.now()}`, bridge_id: p.bridge_id, scenario_id: p.scenario_id, priority: p.severity, summary: `${p.asset_id ?? 'Operational asset'} requires controlled intervention at ${p.location}.`, root_cause_hypotheses: ['Primary failure requires field verification', 'Secondary impact may increase without containment'], recommended_actions: m.actions, safety_flags: p.safety_flags, approval_required: true, approval_reasons: ['Safety-impacting work requires an accountable operator.', 'Completion must be verified by a qualified lead.'], confidence: .95, status: 'pending_approval' }
}
const localChecklist = (p: ParsedEvent): Checklist => ({ bridge_id: p.bridge_id, scenario_id: p.scenario_id, items: metaFor(p.scenario_id).checklist.map((label, i) => ({ id: `${p.scenario_id}-${i}`, label, owner: p.scenario_id === 'water_main_break' ? 'Public works' : p.scenario_id === 'cold_chain_dispatch' ? 'Cold-chain lead' : 'Maintenance', required: true, completed: false, notes: null })) })

type Nav = 'overview' | 'bridge' | 'playbook' | 'history'
type Theme = 'light' | 'dark'
type Tone = 'amber' | 'red' | 'green' | 'blue'
type Metric = { label: string; value: string | number; detail: string; tone: Tone }

const initialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light'
  return window.localStorage.getItem('opsbridge-theme') === 'dark' ? 'dark' : 'light'
}

const statusText = (value: string) => value.replaceAll('_', ' ')
const timeText = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Just now' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function App() {
  const [nav, setNav] = useState<Nav>('overview')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [scenarios, setScenarios] = useState(localScenarios)
  const [scenarioId, setScenarioId] = useState(localScenarios[0].id)
  const [message, setMessage] = useState(localScenarios[0].sample_reports[0])
  const [parsed, setParsed] = useState<ParsedEvent | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [status, setStatus] = useState<BridgeStatus>('received')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(true)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(0)
  const [syncPending, setSyncPending] = useState(0)
  const [changeNote, setChangeNote] = useState('')
  const [sessionHistory, setSessionHistory] = useState<HistoryEntry[]>([])
  const [remoteHistory, setRemoteHistory] = useState<HistoryEntry[] | null>(null)
  const [historySource, setHistorySource] = useState<'api' | 'session'>('session')
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('opsbridge-theme', theme)
  }, [theme])

  const setHistoryRecord = useCallback((entry: HistoryEntry) => {
    setSessionHistory(current => [entry, ...current.filter(item => item.bridge_id !== entry.bridge_id)])
  }, [])
  const updateHistoryStatus = useCallback((bridgeId: string, nextStatus: string, summary?: string) => {
    setSessionHistory(current => current.map(item => item.bridge_id === bridgeId ? { ...item, status: nextStatus, updated_at: new Date().toISOString(), analysis_summary: summary ?? item.analysis_summary } : item))
  }, [])

  const refreshHistory = useCallback(async (quiet = false) => {
    setHistoryLoading(true)
    try {
      const records = await api.history()
      setRemoteHistory(records)
      setHistorySource('api')
      setConnected(true)
      if (!quiet) setNotice(records.length ? `Loaded ${records.length} request${records.length === 1 ? '' : 's'} from the history API.` : 'History API is connected; no saved requests yet.')
    } catch {
      setRemoteHistory(null)
      setHistorySource('session')
      if (!quiet) setNotice('History API is not available. Showing requests created in this session.')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    api.scenarios().then(result => { setScenarios(result); setConnected(true) }).catch(() => setConnected(false))
    void refreshHistory(true)
  }, [refreshHistory])
  useEffect(() => {
    const retryConnection = () => {
      api.health().then(() => setConnected(true)).catch(() => setConnected(false))
    }
    const interval = window.setInterval(retryConnection, 5000)
    window.addEventListener('online', retryConnection)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', retryConnection)
    }
  }, [])
  useEffect(() => { if (nav === 'history') void refreshHistory(true) }, [nav, refreshHistory])

  const effectiveHistory = useMemo(() => {
    const byId = new Map<string, HistoryEntry>()
    for (const item of remoteHistory ?? []) byId.set(item.bridge_id, item)
    for (const item of sessionHistory) byId.set(item.bridge_id, item)
    return [...byId.values()].sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at))
  }, [remoteHistory, sessionHistory])
  const scenario = scenarios.find(item => item.id === scenarioId) ?? localScenarios[0]
  const progress = checklist?.items.length ? Math.round(checklist.items.filter(item => item.completed).length / checklist.items.length * 100) : 0
  const activeRecords = effectiveHistory.filter(item => !['resolved', 'blocked'].includes(item.status))
  const criticalRecords = activeRecords.filter(item => item.severity === 'critical')
  const activeCount = activeRecords.length
  const currentStatus = parsed && effectiveHistory.find(item => item.bridge_id === parsed.bridge_id)?.status
  const run = async <T,>(work: () => Promise<T>, fallback: () => T): Promise<T> => {
    setPending(count => count + 1)
    try { const result = await work(); setConnected(true); return result } catch { setConnected(false); return fallback() } finally { setPending(count => count - 1) }
  }

  const loadScenario = (id: string) => {
    const selected = scenarios.find(item => item.id === id) ?? localScenarios[0]
    setScenarioId(id); setMessage(selected.sample_reports[0] ?? ''); setParsed(null); setAnalysis(null); setChecklist(null); setStatus('received'); setNotice('Scenario adapter loaded. Industrial operations remains the primary workspace.')
  }
  const submit = async () => {
    if (!message.trim()) { setNotice('Enter a frontline report before submitting.'); return }
    setBusy(true)
    let usedFallback = false
    const p = await run(() => api.parse(message, scenarioId), () => { usedFallback = true; return localParse(message, scenarioId) })
    setParsed(p); setAnalysis(null); setChecklist(null); setStatus('parsed')
    setHistoryRecord({ bridge_id: p.bridge_id, scenario_id: p.scenario_id, source_text: p.source_text, status: 'parsed', severity: p.severity, asset_id: p.asset_id, location: p.location, created_at: new Date().toISOString() })
    setNotice(usedFallback ? 'Offline mode: local parser active; request retained in session history.' : 'Report parsed into a traceable bridge request.')
    setNav('bridge'); setBusy(false)
  }
  const analyze = async () => {
    if (!parsed) return
    setBusy(true)
    const result = await run(() => api.analyze(parsed), () => localAnalyze(parsed))
    setAnalysis(result); setStatus(result.status); updateHistoryStatus(parsed.bridge_id, result.status, result.summary); setNotice('Analysis ready for control-room review. Recommendations are tied to this request.')
    setBusy(false)
  }
  const decide = async (decision: 'approved' | 'needs_changes') => {
    if (!analysis || !parsed) return
    if (decision === 'needs_changes' && !changeNote.trim()) { setNotice('Add a review note before requesting changes.'); return }
    setBusy(true)
    await run(() => api.approve(analysis.analysis_id, decision, changeNote), () => ({ status: decision === 'approved' ? 'approved' : 'blocked' }))
    if (decision === 'approved') {
      const nextChecklist = await run(() => api.checklist(analysis.analysis_id), () => localChecklist(parsed))
      setChecklist(nextChecklist); setStatus('approved'); updateHistoryStatus(parsed.bridge_id, 'approved'); setNotice('Approved by Priyanshu. Field checklist issued for controlled execution.'); setNav('playbook')
    } else {
      setStatus('blocked'); updateHistoryStatus(parsed.bridge_id, 'blocked'); setNotice('Changes requested. The request is blocked until the control-room note is addressed.')
    }
    setBusy(false)
  }
  const toggle = async (id: string) => {
    if (!checklist || !parsed) return
    const next = { ...checklist, items: checklist.items.map(item => item.id === id ? { ...item, completed: !item.completed } : item) }
    setChecklist(next)
    const nextStatus: BridgeStatus = next.items.every(item => item.completed) ? 'resolved' : 'in_progress'
    setStatus(nextStatus); updateHistoryStatus(parsed.bridge_id, nextStatus)
    try {
      const syncedChecklist = await api.updateChecklistItem(parsed.bridge_id, id, next.items.find(item => item.id === id)?.completed ?? false)
      setChecklist(syncedChecklist)
      await api.status(parsed.bridge_id, nextStatus)
      setConnected(true)
      setNotice('Checklist update synced to the backend.')
    } catch {
      let usedFallback = false
      await run(() => api.status(parsed.bridge_id, nextStatus), () => { usedFallback = true; return { status: nextStatus } })
      setNotice(usedFallback ? 'Offline mode: checklist completion retained locally and will remain visible in this session.' : 'Checklist saved through bridge status; item detail remains local until a checklist update route is available.')
    }
  }
  const syncNow = async () => {
    setPending(count => count + 1)
    try {
      const [health, mutations] = await Promise.all([api.health(), api.mutations()])
      setConnected(health.status === 'ok'); setSyncPending(mutations.pending); setNotice(mutations.pending ? `${mutations.pending} backend mutation${mutations.pending === 1 ? '' : 's'} waiting for sync.` : 'Backend reachable. Sync queue is clear.')
    } catch { setConnected(false); setNotice('Backend is unreachable. Local requests and checklist state remain available.') } finally { setPending(count => count - 1) }
  }

  const metrics: Metric[] = useMemo(() => [
    { label: 'Active requests', value: activeCount, detail: activeCount ? 'Open bridge requests in current view' : 'No open requests yet', tone: 'amber' },
    { label: 'Critical queue', value: criticalRecords.length, detail: criticalRecords.length ? 'Needs accountable review' : 'No active critical request', tone: 'red' },
    { label: 'Resolved this view', value: effectiveHistory.filter(item => item.status === 'resolved').length, detail: `${effectiveHistory.length} request${effectiveHistory.length === 1 ? '' : 's'} tracked`, tone: 'green' },
    { label: 'Pending sync', value: syncPending || pending, detail: pending ? 'Network operation in progress' : connected ? 'Backend status checked' : 'Local fallback active', tone: 'blue' },
  ], [activeCount, connected, criticalRecords.length, effectiveHistory, pending, syncPending])

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><span /> <span /> <span /></div><div><strong>OpsBridge</strong><small>INDUSTRIAL CONTROL PLANE</small></div></div>
      <div className="workspace-switch"><span className="eyebrow">ACTIVE WORKSPACE</span><div className="workspace-label"><span className="status-dot" /> Industrial operations <span className="fixed-label">FIXED</span></div><small>Production network · Delhi NCR</small></div>
      <nav className="nav-list" aria-label="Primary navigation"><NavItem active={nav === 'overview'} label="Overview" icon="▦" onClick={() => setNav('overview')} /><NavItem active={nav === 'bridge'} label="Bridge workspace" icon="⇄" badge={activeCount ? String(activeCount) : undefined} onClick={() => setNav('bridge')} /><NavItem active={nav === 'playbook'} label="Execution playbook" icon="✓" onClick={() => setNav('playbook')} /><NavItem active={nav === 'history'} label="Incident history" icon="◷" onClick={() => setNav('history')} /></nav>
      <div className="sidebar-footer"><div className="network-card"><span className="network-icon">⌁</span><div><b>{connected ? 'Backend available' : 'Offline-ready'}</b><small>{connected ? 'API connected · session cache on' : 'Local bridge engine active'}</small></div></div><div className="operator"><div className="avatar">P</div><div><b>{OPERATOR_NAME}</b><small>{OPERATOR_ROLE}</small></div></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="breadcrumb">OPSBRIDGE <b>/</b> {nav.toUpperCase()}</span><h1>{nav === 'overview' ? 'Operations overview' : nav === 'bridge' ? 'Bridge workspace' : nav === 'playbook' ? 'Execution playbook' : 'Incident history'}</h1></div><div className="top-actions"><span className="live-pill"><i /> {connected ? 'ONLINE' : 'OFFLINE-READY'}</span><button type="button" className="sync-action" onClick={syncNow} disabled={pending > 0}>↻ Sync status <b>{pending} pending</b></button><button type="button" className="theme-toggle" onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}><span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span><span>{theme === 'light' ? 'Dark' : 'Light'}</span></button></div></header>
      <div className="sync-bar"><span className={connected ? 'sync-online' : 'sync-offline'} /> {connected ? 'Connected to the OpsBridge API. Request records are also retained in this session.' : 'API unavailable. Local parsing, history, and checklist state remain usable.'}<button type="button" className="sync-link" onClick={syncNow}>Check connection</button></div>
      {notice && <div className="notice"><span>●</span>{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
      {nav === 'overview' && <Overview metrics={metrics} history={effectiveHistory} onStart={() => setNav('bridge')} />}
      {nav === 'bridge' && <Bridge scenario={scenario} scenarios={scenarios} scenarioId={scenarioId} onScenario={loadScenario} message={message} setMessage={setMessage} parsed={parsed} analysis={analysis} status={status} busy={busy} onSubmit={submit} onAnalyze={analyze} onDecide={decide} changeNote={changeNote} setChangeNote={setChangeNote} />}
      {nav === 'playbook' && <Playbook checklist={checklist} progress={progress} status={status} onToggle={toggle} onBack={() => setNav('bridge')} />}
      {nav === 'history' && <History records={effectiveHistory} source={historySource} loading={historyLoading} onRefresh={() => refreshHistory()} onOpen={(record) => { setScenarioId(record.scenario_id); setMessage(record.source_text); setStatus(record.status as BridgeStatus); setNav('bridge') }} />}
    </main>
  </div>
}

function NavItem({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: string; badge?: string; onClick: () => void }) { return <button type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span>{label}{badge && <em>{badge}</em>}</button> }

function Overview({ metrics, history, onStart }: { metrics: Metric[]; history: HistoryEntry[]; onStart: () => void }) {
  const statusCounts = history.reduce<Record<string, number>>((counts, item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; return counts }, {})
  const chartTotal = Math.max(history.length, 1)
  return <section className="page-grid"><div className="section-heading"><div><span className="eyebrow">SHIFT COMMAND · INDUSTRIAL RESPONSE</span><h2>Operations overview</h2><p>Track machine breakdown requests from frontline report through accountable field action.</p></div><button className="primary-button" type="button" onClick={onStart}>＋ New bridge request</button></div><div className="metric-grid">{metrics.map(metric => <div className="metric-card" key={metric.label}><div className={`metric-icon ${metric.tone}`}>◈</div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}</div><div className="overview-grid content-grid"><div className="panel chart-panel"><PanelHeader title="Request flow in this view" meta={`${history.length} tracked`} />{history.length ? <><div className="legend"><span><i className="legend-dot critical" />Open</span><span><i className="legend-dot resolved" />Resolved</span><b>{history.length} total</b></div><div className="status-bars">{['parsed', 'pending_approval', 'approved', 'in_progress', 'resolved', 'blocked'].map(status => <div className="status-bar-row" key={status}><span>{statusText(status)}</span><div className="status-bar"><i className={status === 'resolved' ? 'resolved' : status === 'blocked' ? 'blocked' : 'open'} style={{ width: `${(statusCounts[status] ?? 0) / chartTotal * 100}%` }} /></div><b>{statusCounts[status] ?? 0}</b></div>)}</div></> : <EmptyState label="Submit a frontline report to populate request flow." />}</div><div className="panel queue-panel"><PanelHeader title="Latest bridge requests" meta="User-created" />{history.length ? <div className="recent-list">{history.slice(0, 4).map(item => <div className="recent-row" key={item.bridge_id}><div><b>{item.asset_id ?? item.scenario_id}</b><small>{item.location ?? 'Location pending'} · {timeText(item.updated_at ?? item.created_at)}</small></div><span className={`table-status ${item.status}`}><i />{statusText(item.status)}</span></div>)}</div> : <EmptyState label="No requests yet. The queue will reflect your reports." />}</div></div><div className="panel bridge-banner"><div className="banner-copy"><span className="eyebrow">THE INDUSTRIAL BREAKDOWN LOOP</span><h3>Turn a machine report into a controlled recovery.</h3><p>Capture what the operator saw, inspect the structured event, approve safety-sensitive work, and hand maintenance a traceable checklist.</p><button className="secondary-button" type="button" onClick={onStart}>Open bridge workspace →</button></div></div></section>
}

function Bridge({ scenario, scenarios, scenarioId, onScenario, message, setMessage, parsed, analysis, status, busy, onSubmit, onAnalyze, onDecide, changeNote, setChangeNote }: { scenario: Scenario; scenarios: Scenario[]; scenarioId: string; onScenario: (id: string) => void; message: string; setMessage: (value: string) => void; parsed: ParsedEvent | null; analysis: Analysis | null; status: BridgeStatus; busy: boolean; onSubmit: () => void; onAnalyze: () => void; onDecide: (decision: 'approved' | 'needs_changes') => void; changeNote: string; setChangeNote: (value: string) => void }) {
  return <section className="page-grid bridge-page"><div className="section-heading"><div><span className="eyebrow">REQUEST INTAKE · CONTROL ROOM</span><h2>Bridge workspace</h2><p>Translate a frontline machine signal into a verified operational decision.</p></div><div className="bridge-id"><span>REQUEST ID</span><b>{parsed?.bridge_id ?? 'Awaiting input'}</b></div></div><div className="stepper"><Step n="1" label="Report" active={!parsed} done={Boolean(parsed)} /><Step n="2" label="Structure" active={Boolean(parsed) && !analysis} done={Boolean(analysis)} /><Step n="3" label="Approve" active={Boolean(analysis) && status === 'pending_approval'} done={status === 'approved'} /><Step n="4" label="Execute" active={status === 'approved' || status === 'in_progress'} done={status === 'resolved'} /></div><div className="bridge-columns"><div className="panel intake-panel"><PanelHeader title="01 / Frontline report" meta="Human input" /><div className="field-label">SCENARIO ADAPTER</div><select aria-label="Scenario" value={scenarioId} onChange={event => onScenario(event.target.value)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><div className="adapter-copy">{scenario.description}</div><div className="adapter-tags">{scenario.tags.map(tag => <span key={tag}>#{tag}</span>)}</div><div className="field-label">REPORT IN NATURAL LANGUAGE</div><textarea aria-label="Frontline report" value={message} onChange={event => setMessage(event.target.value)} rows={6} placeholder="Example: Machine 4 ka motor overheat ho raha hai..." /><button type="button" className="text-button" onClick={() => setMessage(scenario.sample_reports[0] ?? '')}>Load sample report</button><button type="button" className="primary-button full-width" disabled={busy} onClick={onSubmit}>{busy ? 'Processing…' : 'Submit to bridge →'}</button></div><div className="bridge-middle"><div className="bridge-core">⇄<span className="eyebrow">BRIDGE ENGINE</span><strong>Structured<br />meaning</strong><small>Rules-based parser with offline fallback</small></div></div><div className="panel analysis-panel"><PanelHeader title="02 / Operational meaning" meta={parsed ? 'Parsed' : 'Waiting'} />{parsed ? <><div className="analysis-status"><span className="status-badge parsed"><i /> {statusText(status).toUpperCase()}</span><b>{Math.round(parsed.confidence * 100)}% confidence</b></div><div className="entity-grid"><Entity label="Asset / system" value={parsed.asset_id ?? 'Not identified'} /><Entity label="Event" value={parsed.event_type} /><Entity label="Severity" value={parsed.severity} danger={parsed.severity === 'critical'} /><Entity label="Location" value={parsed.location ?? 'Reported location'} /></div><div className="symptoms"><div className="field-label">OBSERVED SIGNALS</div><div>{parsed.symptoms.length ? parsed.symptoms.map(symptom => <span key={symptom}>{symptom}</span>) : <small>No symptoms extracted; verify with operator.</small>}</div></div><div className="score-strip"><div><span>SAFETY FLAGS</span><strong>{parsed.safety_flags.length}</strong></div><div><span>DOWNTIME</span><strong>{parsed.downtime_minutes ?? '—'}<span>{parsed.downtime_minutes ? ' min' : ''}</span></strong></div><div><span>KEYWORDS</span><strong>{parsed.extracted_keywords.length}</strong></div></div><details className="json-disclosure"><summary>View structured event payload</summary><pre>{JSON.stringify(parsed, null, 2)}</pre></details><RiskAnalysisCard parsed={parsed} analysis={analysis} busy={busy} onAnalyze={onAnalyze} />{analysis && <div className="recommendation-panel"><div className="field-label">CONTROL-ROOM RECOMMENDATION &amp; APPROVAL</div><p>{analysis.summary}</p><ul>{analysis.recommended_actions.slice(0, 3).map(action => <li key={action}>{action}</li>)}</ul><div className="approval-reason">{analysis.approval_reasons[0] ?? 'Review before execution.'}</div><div className="recommendation-footer"><input aria-label="Review note" placeholder="Review note (required for changes)" value={changeNote} onChange={event => setChangeNote(event.target.value)} /><button type="button" className="primary-button" disabled={busy} onClick={() => onDecide('approved')}>Approve</button><button type="button" className="ghost-button" disabled={busy} onClick={() => onDecide('needs_changes')}>Request changes</button></div></div>}</> : <EmptyState label="Submit a report to see the asset, severity, and safety signals here." />}</div></div></section>
}

function RiskAnalysisCard({ parsed, analysis, busy, onAnalyze }: { parsed: ParsedEvent; analysis: Analysis | null; busy: boolean; onAnalyze: () => void }) {
  const flags = analysis?.safety_flags ?? parsed.safety_flags
  const riskLevel = analysis?.priority ?? parsed.severity
  const confidence = analysis?.confidence ?? parsed.confidence
  const impactSummary = analysis?.summary ?? `${parsed.asset_id ?? 'The reported asset'} at ${parsed.location ?? 'the reported location'} shows ${parsed.symptoms.length ? parsed.symptoms.join(', ') : 'an operational signal'}${parsed.downtime_minutes ? ` with an estimated ${parsed.downtime_minutes}-minute downtime window.` : '.'}`
  const approvalReason = analysis ? (analysis.approval_required ? (analysis.approval_reasons.join(' ') || 'A human operator must confirm the response before controlled execution.') : 'Analysis does not require an additional approval gate.') : flags.length ? 'Safety flags are present. Risk analysis must establish the accountable human approval path before execution.' : 'Run risk analysis to determine the approval path for this request.'
  return <section className={`risk-analysis-card ${analysis ? 'risk-ready' : 'risk-pending'}`} aria-labelledby="risk-analysis-heading"><div className="risk-card-heading"><div><span className="eyebrow">03 / RISK ANALYSIS</span><h3 id="risk-analysis-heading">Risk analysis</h3><p>{analysis ? 'Derived from the active parsed request and ready for control-room review.' : 'Make the response risk explicit before approval.'}</p></div><span className={`status-badge ${analysis ? 'approved' : 'waiting'}`}><i /> {analysis ? 'ANALYSIS READY' : 'NOT RUN'}</span></div><div className="risk-field-grid"><div className="risk-field"><span>RISK LEVEL / PRIORITY</span><strong className={`risk-priority ${riskLevel}`}>{statusText(riskLevel)}</strong></div><div className="risk-field"><span>CONFIDENCE</span><strong>{Math.round(confidence * 100)}%</strong></div><div className="risk-field"><span>DOWNTIME / RESPONSE WINDOW</span><strong>{parsed.downtime_minutes != null ? `${parsed.downtime_minutes} min estimated` : 'No estimate returned'}</strong></div><div className="risk-field"><span>SAFETY FLAGS</span><strong>{flags.length ? `${flags.length} detected` : 'None returned'}</strong><div className="risk-chips">{flags.length ? flags.map(flag => <span key={flag}>{flag}</span>) : <small>Verify conditions in the field.</small>}</div></div><div className="risk-field risk-wide"><span>IMPACT SUMMARY</span><p>{impactSummary}</p></div><div className="risk-field"><span>LIKELY CAUSES</span>{analysis?.root_cause_hypotheses.length ? <ul>{analysis.root_cause_hypotheses.map(cause => <li key={cause}>{cause}</li>)}</ul> : <p className="risk-muted">{analysis ? 'No likely causes returned; verify in the field.' : 'Awaiting risk analysis.'}</p>}</div><div className="risk-field"><span>WHY HUMAN APPROVAL IS REQUIRED</span><p>{approvalReason}</p></div></div>{!analysis && <button type="button" className="primary-button risk-action" disabled={busy} onClick={onAnalyze}>{busy ? 'Analyzing…' : 'Run risk analysis →'}</button>}</section>
}

function Playbook({ checklist, progress, status, onToggle, onBack }: { checklist: Checklist | null; progress: number; status: BridgeStatus; onToggle: (id: string) => void; onBack: () => void }) { return <section className="page-grid"><div className="section-heading"><div><span className="eyebrow">04 / FIELD EXECUTION</span><h2>Execution playbook</h2><p>Complete the approved recovery actions and leave a traceable status.</p></div><button type="button" className="ghost-button" onClick={onBack}>← Back to bridge</button></div>{checklist ? <div className="panel checklist-panel"><div className="checklist-head"><div><span className={`status-badge ${status === 'resolved' ? 'approved' : 'parsed'}`}><i /> {status === 'resolved' ? 'RESOLVED' : 'APPROVED FOR EXECUTION'}</span><h3>Scenario response checklist</h3><p>Each change is applied locally first, then synced when a backend route is available.</p></div><div className="progress-ring"><strong>{progress}%</strong><span>complete</span></div></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="checklist-items">{checklist.items.map((item, index) => <button type="button" className={`check-item ${item.completed ? 'complete' : ''}`} key={item.id} onClick={() => onToggle(item.id)}><span className="check-box">{item.completed ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="check-copy"><b>{item.label}</b><small>Owner · {item.owner}</small></span><span className="item-state">{item.completed ? 'Done' : 'Open'}</span></button>)}</div></div> : <div className="panel empty-state"><p>Approve a bridge response to issue a field checklist.</p></div>}</section> }

function History({ records, source, loading, onRefresh, onOpen }: { records: HistoryEntry[]; source: 'api' | 'session'; loading: boolean; onRefresh: () => void; onOpen: (record: HistoryEntry) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const filtered = records.filter(record => (filter === 'all' || record.status === filter) && `${record.bridge_id} ${record.asset_id ?? ''} ${record.source_text} ${record.location ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const statuses = [...new Set(records.map(record => record.status))]
  return <section className="page-grid"><div className="section-heading"><div><span className="eyebrow">TRACEABILITY · REQUEST RECORDS</span><h2>Incident history</h2><p>Review user-created bridge requests and reopen the report that needs attention.</p></div><button type="button" className="ghost-button" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh history'}</button></div><div className="history-source"><span className={source === 'api' ? 'sync-online' : 'sync-offline'} /> {source === 'api' ? 'History API connected' : 'Session history fallback'}<small>{source === 'api' ? 'Remote records are merged with requests created in this session.' : 'The current backend has no listing route; these are requests created since this page opened.'}</small></div><div className="panel table-panel"><div className="table-toolbar"><label className="search-box">⌕<input aria-label="Search history" placeholder="Search asset, location, or report" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter history" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option>{statuses.map(item => <option key={item} value={item}>{statusText(item)}</option>)}</select></div>{filtered.length ? <table><thead><tr><th>REQUEST</th><th>ASSET / LOCATION</th><th>SEVERITY</th><th>STATUS</th><th>UPDATED</th><th /></tr></thead><tbody>{filtered.map(record => <tr key={record.bridge_id}><td><strong className="mono">{record.bridge_id}</strong><small className="table-subcopy">{record.source_text}</small></td><td><strong>{record.asset_id ?? 'Asset pending'}</strong><small className="table-subcopy">{record.location ?? 'Location pending'}</small></td><td><span className={record.severity === 'critical' ? 'danger-text' : ''}>{record.severity}</span></td><td><span className={`table-status ${record.status}`}><i />{statusText(record.status)}</span></td><td>{timeText(record.updated_at ?? record.created_at)}</td><td><button type="button" className="row-action" onClick={() => onOpen(record)}>OPEN</button></td></tr>)}</tbody></table> : <EmptyState label={records.length ? 'No requests match this filter.' : 'No user-created requests yet. Start in Bridge workspace.'} />}</div></section>
}

function Step({ n, label, active, done }: { n: string; label: string; active: boolean; done: boolean }) { return <div className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`}><span>{done ? '✓' : n}</span><b>{label}</b></div> }
function PanelHeader({ title, meta }: { title: string; meta: string }) { return <div className="panel-header"><h3>{title}</h3><span>{meta}</span></div> }
function Entity({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="entity"><span>{label}</span><b className={danger ? 'danger-text' : ''}>{value}</b></div> }
function EmptyState({ label }: { label: string }) { return <div className="empty-state"><span>⇄</span><p>{label}</p></div> }
