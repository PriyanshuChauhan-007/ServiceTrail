import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from './api'
import type { Analysis, BridgeStatus, Checklist, ParsedEvent, Scenario } from './types'

const localScenarios: Scenario[] = [
  { id: 'cnc_press_breakdown', name: 'CNC press line breakdown', category: 'industrial', description: 'A hydraulic stamping press has stopped mid-run in Bay 3.', criticality: 'critical', tags: ['maintenance', 'hydraulic', 'production'], sample_reports: ['Machine 4 ka motor overheat ho raha hai, production ruk gaya hai.'] },
  { id: 'water_main_break', name: 'Municipal water main break', category: 'civic', description: 'A water main failure affects traffic and nearby residents.', criticality: 'high', tags: ['public-works', 'water', 'traffic'], sample_reports: ['School ke paas road par paani bhar gaya hai, traffic jam ho raha hai.'] },
  { id: 'cold_chain_dispatch', name: 'Cold-chain dispatch interruption', category: 'logistics', description: 'A refrigerated route is delayed and product quality is at risk.', criticality: 'high', tags: ['warehouse', 'reefer', 'quality'], sample_reports: ['Truck late hai aur shipment temperature limit cross kar rahi hai.'] },
]

const localParse = (text: string, scenarioId: string): ParsedEvent => ({
  bridge_id: `bridge_demo_${Date.now()}`,
  scenario_id: scenarioId,
  source_text: text,
  event_type: scenarioId === 'cnc_press_breakdown' ? 'equipment_breakdown' : scenarioId === 'water_main_break' ? 'public_utility_failure' : 'logistics_interruption',
  asset_id: scenarioId === 'cnc_press_breakdown' ? 'MACHINE-04' : scenarioId === 'water_main_break' ? 'WATER-MAIN-05' : 'REEFER-12',
  machine: scenarioId === 'cnc_press_breakdown' ? 'MACHINE-04' : null,
  location: scenarioId === 'cnc_press_breakdown' ? 'Bay 3 / Production Cell A' : scenarioId === 'water_main_break' ? 'School Road / Sector 5' : 'North distribution route',
  symptoms: scenarioId === 'cnc_press_breakdown' ? ['motor overheating', 'asset stopped'] : scenarioId === 'water_main_break' ? ['water leak', 'flooding'] : ['route delay', 'temperature excursion'],
  severity: 'critical',
  safety_flags: scenarioId === 'cnc_press_breakdown' ? ['unsafe operating condition'] : ['operational hazard'],
  downtime_minutes: 42,
  quantities: scenarioId === 'cold_chain_dispatch' ? { pallets: 24 } : {},
  impact_score: 86,
  impact_summary: 'Production cell interruption with potential personnel and equipment exposure.',
  extracted_keywords: ['breakdown', 'stopped', 'shutdown'],
  confidence: 0.92,
})

const localAnalyze = (parsed: ParsedEvent): Analysis => ({
  analysis_id: `analysis_demo_${Date.now()}`,
  bridge_id: parsed.bridge_id,
  scenario_id: parsed.scenario_id,
  priority: 'critical',
  summary: `${parsed.asset_id ?? 'Operational asset'} requires controlled intervention at ${parsed.location}.`,
  root_cause_hypotheses: ['Thermal overload or component failure', 'Unexpected mechanical obstruction', 'Control/interlock trip requiring qualified reset'],
  recommended_actions: ['Stop the affected cell and apply lockout/tagout before inspection.', 'Capture alarm codes and inspect for visible damage.', 'Have a qualified maintenance lead verify the repair before a guarded test cycle.'],
  safety_flags: parsed.safety_flags,
  approval_required: true,
  approval_reasons: ['Safety-impacting work requires an accountable operator.', 'Production restart must be verified by a qualified lead.'],
  confidence: 0.95,
  status: 'pending_approval',
})

const localChecklist = (parsed: ParsedEvent): Checklist => ({
  bridge_id: parsed.bridge_id,
  scenario_id: parsed.scenario_id,
  items: [
    { id: 'isolate', label: 'Machine ko safely stop karein aur zero-energy state verify karein.', owner: 'Maintenance', required: true, completed: false, notes: null },
    { id: 'inspect', label: 'Alarm code, visible damage aur temperature reading record karein.', owner: 'Maintenance', required: true, completed: false, notes: null },
    { id: 'brief', label: 'Guarded test cycle se pehle shift lead ko brief karein.', owner: 'Shift lead', required: true, completed: false, notes: null },
  ],
})

const tempData = [
  { time: '10:52', value: 54 }, { time: '10:58', value: 61 }, { time: '11:04', value: 68 }, { time: '11:10', value: 76 }, { time: '11:16', value: 84 }, { time: '11:22', value: 91 },
]
const incidentBars = [{ name: 'Mon', critical: 2, resolved: 5 }, { name: 'Tue', critical: 4, resolved: 7 }, { name: 'Wed', critical: 3, resolved: 8 }, { name: 'Thu', critical: 6, resolved: 6 }, { name: 'Fri', critical: 5, resolved: 9 }, { name: 'Sat', critical: 2, resolved: 4 }]

type Nav = 'overview' | 'bridge' | 'playbook' | 'history'

export default function App() {
  const [nav, setNav] = useState<Nav>('overview')
  const [scenarios, setScenarios] = useState<Scenario[]>(localScenarios)
  const [scenarioId, setScenarioId] = useState('cnc_press_breakdown')
  const [message, setMessage] = useState(localScenarios[0].sample_reports[0])
  const [parsed, setParsed] = useState<ParsedEvent | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [status, setStatus] = useState<BridgeStatus>('received')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [connected, setConnected] = useState(true)

  useState(() => {
    api.scenarios().then(setScenarios).catch(() => setConnected(false))
  })

  const scenario = scenarios.find((item) => item.id === scenarioId) ?? localScenarios[0]
  const progress = checklist ? Math.round((checklist.items.filter((item) => item.completed).length / checklist.items.length) * 100) : 0
  const activeTitle = nav === 'overview' ? 'Operations overview' : nav === 'bridge' ? 'Bridge workspace' : nav === 'playbook' ? 'Execution playbook' : 'Incident history'

  const loadScenario = (id: string) => {
    const next = scenarios.find((item) => item.id === id) ?? localScenarios[0]
    setScenarioId(id)
    setMessage(next.sample_reports[0] ?? '')
    setParsed(null)
    setAnalysis(null)
    setChecklist(null)
    setStatus('received')
    setNotice('Scenario loaded. Ready for a new frontline report.')
  }

  const submitReport = async () => {
    if (!message.trim()) return setNotice('Enter a frontline report before submitting.')
    setBusy(true)
    setNotice('Extracting operational meaning…')
    try {
      const event = connected ? await api.parse(message, scenarioId) : localParse(message, scenarioId)
      setParsed(event)
      setStatus('parsed')
      setNotice('Report parsed into a validated bridge request.')
      setNav('bridge')
    } catch {
      setConnected(false)
      const event = localParse(message, scenarioId)
      setParsed(event)
      setStatus('parsed')
      setNotice('Offline demo mode: local bridge parser active.')
      setNav('bridge')
    } finally { setBusy(false) }
  }

  const runAnalysis = async () => {
    if (!parsed) return
    setBusy(true)
    setNotice('Running risk and constraint analysis…')
    try {
      const result = connected ? await api.analyze(parsed) : localAnalyze(parsed)
      setAnalysis(result)
      setStatus('pending_approval')
      setNotice('Recommendation generated. Human approval is required.')
    } catch {
      setConnected(false)
      setAnalysis(localAnalyze(parsed))
      setStatus('pending_approval')
      setNotice('Offline demo mode: deterministic analysis engine active.')
    } finally { setBusy(false) }
  }

  const approve = async () => {
    if (!analysis || !parsed) return
    setBusy(true)
    try { if (connected) await api.approve(analysis.analysis_id, 'approved') } catch { setConnected(false) }
    const nextChecklist = connected ? await api.checklist(analysis.analysis_id).catch(() => localChecklist(parsed)) : localChecklist(parsed)
    setChecklist(nextChecklist)
    setStatus('approved')
    setNotice('Response approved. Field execution checklist issued.')
    setNav('playbook')
    setBusy(false)
  }

  const toggleChecklist = async (id: string) => {
    if (!checklist || !parsed) return
    const next = { ...checklist, items: checklist.items.map((item) => item.id === id ? { ...item, completed: !item.completed } : item) }
    setChecklist(next)
    if (next.items.every((item) => item.completed)) {
      setStatus('resolved')
      setNotice('All required steps complete. Incident resolved and audit trail updated.')
      if (connected) await api.status(parsed.bridge_id, 'resolved').catch(() => setConnected(false))
    } else {
      setStatus('in_progress')
      if (connected) await api.status(parsed.bridge_id, 'in_progress').catch(() => setConnected(false))
    }
  }

  const metricData = useMemo(() => [
    { label: 'Bridge status', value: parsed ? status.replace('_', ' ') : 'Ready', detail: connected ? 'Backend connected' : 'Offline demo mode', tone: 'amber' },
    { label: 'Safety flags', value: parsed?.safety_flags.length ?? 0, detail: parsed ? 'Current report' : 'Awaiting report', tone: 'red' },
    { label: 'Confidence', value: parsed ? `${Math.round(parsed.confidence * 100)}%` : '—', detail: 'Current bridge only', tone: 'green' },
    { label: 'Impact score', value: parsed?.impact_score ?? '—', detail: 'Rule-based estimate', tone: 'blue' },
  ], [connected, parsed, status])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span /> <span /> <span /></div><div><strong>OpsBridge</strong><small>CONTROL PLANE</small></div></div>
        <div className="workspace-switch"><span className="eyebrow">ACTIVE WORKSPACE</span><button><span className="status-dot" /> Industrial operations <span className="chevron">⌄</span></button><small>Production network · Delhi NCR</small></div>
        <nav className="nav-list" aria-label="Primary navigation">
          <NavItem active={nav === 'overview'} label="Overview" icon="▦" onClick={() => setNav('overview')} />
          <NavItem active={nav === 'bridge'} label="Bridge workspace" icon="⇄" badge={parsed && status !== 'resolved' ? '1' : undefined} onClick={() => setNav('bridge')} />
          <NavItem active={nav === 'playbook'} label="Execution playbook" icon="✓" onClick={() => setNav('playbook')} />
          <NavItem active={nav === 'history'} label="Incident history" icon="◷" onClick={() => setNav('history')} />
        </nav>
        <div className="sidebar-footer"><div className="network-card"><span className="network-icon">⌁</span><div><b>Offline-ready</b><small>{connected ? 'API connected · local cache on' : 'Local demo engine active'}</small></div></div><div className="operator"><div className="avatar">RK</div><div><b>Riya Kapoor</b><small>Control room lead</small></div><span>•••</span></div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div><span className="breadcrumb">OPSBRIDGE <b>/</b> {activeTitle.toUpperCase()}</span><h1>{activeTitle}</h1></div><div className="top-actions"><span className="live-pill"><i /> SYSTEM LIVE</span><span className="clock">SAT, 17 OCT 2026 <b>11:28:43</b></span><button className="icon-button" aria-label="Notifications">♢<sup>3</sup></button></div></header>
        {notice && <div className="notice"><span>◆</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}

        {nav === 'overview' && <Overview metrics={metricData} onStart={() => setNav('bridge')} />}
        {nav === 'bridge' && <BridgeWorkspace scenario={scenario} scenarios={scenarios} scenarioId={scenarioId} onScenario={loadScenario} message={message} setMessage={setMessage} parsed={parsed} analysis={analysis} status={status} busy={busy} onSubmit={submitReport} onAnalyze={runAnalysis} onApprove={approve} />}
        {nav === 'playbook' && <Playbook checklist={checklist} progress={progress} status={status} onToggle={toggleChecklist} onBack={() => setNav('bridge')} />}
        {nav === 'history' && <History />}
      </main>
    </div>
  )
}

function NavItem({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: string; badge?: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon">{icon}</span>{label}{badge && <em>{badge}</em>}</button>
}

function Overview({ metrics, onStart }: { metrics: { label: string; value: string | number; detail: string; tone: string }[]; onStart: () => void }) {
  return <section className="page-grid">
    <div className="section-heading"><div><span className="eyebrow">SHIFT COMMAND · 11:28 IST</span><h2>Good morning, Riya <span className="wave">✦</span></h2><p>Here’s the operational pulse across your connected workspaces.</p></div><button className="primary-button" onClick={onStart}><span>＋</span> New bridge request</button></div>
    <div className="metric-grid">{metrics.map((metric) => <div className="metric-card" key={metric.label}><div className={`metric-icon ${metric.tone}`}>{metric.tone === 'red' ? '!' : metric.tone === 'green' ? '↗' : metric.tone === 'blue' ? '₹' : '◈'}</div><span>{metric.label}</span><strong>{metric.value}</strong><small className={metric.tone === 'red' ? 'danger-text' : 'positive-text'}>{metric.detail}</small></div>)}</div>
    <div className="content-grid overview-grid"><div className="panel chart-panel"><PanelHeader title="Incident throughput" meta="Last 7 days" /><div className="legend"><span><i className="legend-dot critical" /> Critical</span><span><i className="legend-dot resolved" /> Resolved</span><b>32 total</b></div><ResponsiveContainer width="100%" height={230}><BarChart data={incidentBars} barGap={5}><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="#273141" /><XAxis dataKey="name" tick={{ fill: '#718096', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#718096', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#141b27', border: '1px solid #2b3748', borderRadius: 8, color: '#f7fafc' }} /><Bar dataKey="critical" fill="#f59e0b" radius={[3, 3, 0, 0]} /><Bar dataKey="resolved" fill="#3d7cff" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="panel queue-panel"><PanelHeader title="Priority queue" meta="4 require action" /><div className="queue-list"><QueueItem severity="critical" title="CNC press line breakdown" detail="Bay 3 · Machine 04" age="02m" /><QueueItem severity="high" title="Reefer route temperature alert" detail="North route · Truck 12" age="11m" /><QueueItem severity="medium" title="Hydraulic sensor warning" detail="Assembly · Cell 02" age="34m" /></div><button className="text-button" onClick={onStart}>Open bridge workspace <span>→</span></button></div></div>
    <div className="panel bridge-banner"><div className="banner-copy"><span className="eyebrow">THE BRIDGE LOOP</span><h3>From frontline words to operational action.</h3><p>OpsBridge turns unstructured reports into explainable, human-approved workflows — then sends a clear action plan back to the field.</p><button className="secondary-button" onClick={onStart}>Run a live bridge <span>→</span></button></div><div className="loop-diagram"><LoopStep number="01" label="Frontline" sub="Natural report" /><span className="loop-arrow">→</span><LoopStep number="02" label="Bridge engine" sub="Meaning + risk" active /><span className="loop-arrow">→</span><LoopStep number="03" label="Control room" sub="Human approval" /><span className="loop-arrow">→</span><LoopStep number="04" label="Field" sub="Action checklist" /></div></div>
  </section>
}

function BridgeWorkspace({ scenario, scenarios, scenarioId, onScenario, message, setMessage, parsed, analysis, status, busy, onSubmit, onAnalyze, onApprove }: { scenario: Scenario; scenarios: Scenario[]; scenarioId: string; onScenario: (id: string) => void; message: string; setMessage: (value: string) => void; parsed: ParsedEvent | null; analysis: Analysis | null; status: BridgeStatus; busy: boolean; onSubmit: () => void; onAnalyze: () => void; onApprove: () => void }) {
  return <section className="page-grid bridge-page"><div className="section-heading"><div><span className="eyebrow">BIDIRECTIONAL WORKFLOW · REQUEST INTAKE</span><h2>Bridge workspace</h2><p>Translate a frontline signal into a verified operational decision.</p></div><div className="bridge-id">{parsed ? <><span>REQUEST ID</span><b>{parsed.bridge_id.replace('bridge_', 'BR-').toUpperCase()}</b></> : <><span>NEW REQUEST</span><b>Awaiting input</b></>}</div></div>
    <div className="stepper"><Step label="Frontline report" number="01" active={!parsed} done={!!parsed} /><Step label="Bridge analysis" number="02" active={!!parsed && !analysis} done={!!analysis} /><Step label="Control-room approval" number="03" active={!!analysis && status === 'pending_approval'} done={status === 'approved' || status === 'resolved'} /><Step label="Field execution" number="04" active={status === 'approved' || status === 'in_progress'} done={status === 'resolved'} /></div>
    <div className="bridge-columns"><div className="panel intake-panel"><PanelHeader title="01 / Frontline report" meta="Human input" /><div className="field-label"><span>WORKSPACE ADAPTER</span><span className="field-hint">Same bridge, different context</span></div><select value={scenarioId} onChange={(event) => onScenario(event.target.value)}>{scenarios.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><div className="adapter-tags">{scenario.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><div className="field-label"><span>REPORT IN NATURAL LANGUAGE</span><span className="language-badge">HINGLISH ▾</span></div><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe what is happening in the field…" rows={6} /><div className="sample-row"><span>Try a sample:</span><button onClick={() => setMessage(scenario.sample_reports[0] ?? '')}>Load frontline report</button></div><button className="primary-button full-width" disabled={busy} onClick={onSubmit}>{busy ? 'Processing…' : 'Submit to bridge'} <span>→</span></button><div className="privacy-note"><span>◉</span> Local-first intake · No report leaves this workspace</div></div>
      <div className="bridge-middle"><div className="bridge-line"><span className="pulse" /></div><div className="bridge-core"><div className="core-orbit">⇄</div><span className="eyebrow">BRIDGE ENGINE</span><strong>Meaning<br />extraction</strong><small>Structured · explainable<br />human-in-the-loop</small></div><div className="bridge-line bottom"><span className="pulse" /></div></div>
      <div className="panel analysis-panel"><PanelHeader title="02 / Operational meaning" meta={parsed ? 'Parsed' : 'Waiting'} /><div className="analysis-status"><span className={`status-badge ${parsed ? 'parsed' : 'waiting'}`}><i /> {parsed ? 'BRIDGE REQUEST PARSED' : 'AWAITING FRONTLINE INPUT'}</span>{parsed && <b>{Math.round(parsed.confidence * 100)}% confidence</b>}</div>{parsed ? <><div className="entity-grid"><Entity label="Asset / system" value={parsed.asset_id ?? 'Not identified'} /><Entity label="Event type" value={parsed.event_type.replaceAll('_', ' ')} /><Entity label="Location" value={parsed.location ?? 'Reported location'} /><Entity label="Severity" value={parsed.severity.toUpperCase()} danger /></div><div className="symptoms"><span className="field-label">SIGNALS EXTRACTED</span><div>{parsed.symptoms.map((symptom) => <span key={symptom}>{symptom}</span>)}</div></div><div className="score-strip"><div><span>IMPACT SCORE</span><strong>86<span>/100</span></strong></div><div><span>RESPONSE WINDOW</span><strong>42<span> min</span></strong></div><div><span>SAFETY FLAGS</span><strong>{parsed.safety_flags.length}</strong></div></div>{!analysis && <button className="secondary-button full-width" disabled={busy} onClick={onAnalyze}>{busy ? 'Analyzing…' : 'Run risk analysis'} <span>↗</span></button>}</> : <EmptyState label="Submit a frontline report to see the structured bridge request." />}</div></div>
    {analysis && <div className="panel recommendation-panel"><div className="recommendation-head"><div><span className="eyebrow">03 / CONTROL ROOM DECISION</span><h3>Recommendation ready for approval</h3><p>{analysis.summary}</p></div><span className="priority-badge">{analysis.priority.toUpperCase()} PRIORITY</span></div><div className="recommendation-grid"><div className="recommendation-copy"><span className="field-label">RECOMMENDED RESPONSE</span>{analysis.recommended_actions.map((action, index) => <div className="action-row" key={action}><span>{String(index + 1).padStart(2, '0')}</span><p>{action}</p></div>)}<div className="approval-reason"><span>⚠</span><div><b>Human approval required</b><small>{analysis.approval_reasons[0]}</small></div></div></div><div className="signal-chart"><div className="chart-title"><span>THERMAL LOAD / MACHINE 04</span><b>91%</b></div><ResponsiveContainer width="100%" height={120}><AreaChart data={tempData}><defs><linearGradient id="heat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f05252" stopOpacity={0.32} /><stop offset="100%" stopColor="#f05252" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="2 5" vertical={false} stroke="#273141" /><XAxis dataKey="time" hide /><YAxis hide domain={[40, 100]} /><Area type="monotone" dataKey="value" stroke="#f05252" fill="url(#heat)" strokeWidth={2} /></AreaChart></ResponsiveContainer><div className="chart-foot"><span>10:52</span><span>Current</span></div></div></div><div className="recommendation-footer"><div className="confidence"><span>DECISION CONFIDENCE</span><strong>{Math.round(analysis.confidence * 100)}%</strong><div className="confidence-bar"><i style={{ width: `${analysis.confidence * 100}%` }} /></div></div><div className="button-row"><button className="ghost-button" onClick={() => window.alert('Review note added to the audit timeline.')}>Request changes</button><button className="primary-button" disabled={busy || status === 'approved'} onClick={onApprove}>{status === 'approved' ? '✓ Response approved' : busy ? 'Approving…' : 'Approve response →'}</button></div></div></div>}
  </section>
}

function Playbook({ checklist, progress, status, onToggle, onBack }: { checklist: Checklist | null; progress: number; status: BridgeStatus; onToggle: (id: string) => void; onBack: () => void }) {
  return <section className="page-grid"><div className="section-heading"><div><span className="eyebrow">04 / FIELD EXECUTION</span><h2>Execution playbook</h2><p>Convert an approved decision into a clear, trackable field action.</p></div><button className="ghost-button" onClick={onBack}>← Back to bridge</button></div>{checklist ? <div className="playbook-layout"><div className="panel checklist-panel"><div className="checklist-head"><div><span className="status-badge approved"><i /> APPROVED FOR EXECUTION</span><h3>Machine 04 · corrective response</h3><p>Assigned to Maintenance · Bay 3 / Production Cell A</p></div><div className="progress-ring"><strong>{progress}%</strong><span>complete</span></div></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="checklist-items">{checklist.items.map((item, index) => <button className={`check-item ${item.completed ? 'complete' : ''}`} key={item.id} onClick={() => onToggle(item.id)}><span className="check-box">{item.completed ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="check-copy"><b>{item.label}</b><small>Owner · {item.owner}</small></span><span className="item-state">{item.completed ? 'Done' : 'Open'} <span>›</span></span></button>)}</div>{status === 'resolved' && <div className="resolved-banner"><span>✓</span><div><b>Incident resolved</b><small>All required actions were completed and added to the audit timeline.</small></div></div>}</div><div className="panel audit-panel"><PanelHeader title="Bridge audit" meta="Live" /><Audit time="11:23:04" label="Frontline report received" detail="Hinglish · Field worker" done /><Audit time="11:23:07" label="Meaning extracted" detail="92% confidence" done /><Audit time="11:23:11" label="Risk analysis completed" detail="Critical priority" done /><Audit time="11:23:19" label="Response approved" detail="Riya Kapoor" done /><Audit time="Now" label="Field execution" detail={status === 'resolved' ? 'Resolved' : 'Awaiting completion'} done={status === 'resolved'} active={status !== 'resolved'} /></div></div> : <div className="panel empty-large"><div className="empty-icon">✓</div><h3>No approved response yet</h3><p>Complete a bridge request and approve the recommended response to issue a field playbook.</p><button className="primary-button" onClick={onBack}>Open bridge workspace →</button></div>}</section>
}

function History() { const rows = [['BR-8F31A2', 'CNC press line breakdown', 'Machine 04 · Bay 3', 'Resolved', '08m'], ['BR-2C9D10', 'Reefer route interruption', 'Truck 12 · North route', 'In progress', '21m'], ['BR-11AE72', 'Hydraulic sensor warning', 'Cell 02 · Assembly', 'Awaiting approval', '34m'], ['BR-7D44B0', 'CNC spindle vibration', 'Machine 02 · Bay 1', 'Resolved', '1h 12m']]; return <section className="page-grid"><div className="section-heading"><div><span className="eyebrow">TRACEABILITY · ALL WORKSPACES</span><h2>Incident history</h2><p>A searchable record of every bridge request and decision.</p></div><button className="secondary-button" onClick={() => window.alert('CSV export prepared for the current incident view.')}>↓ Export CSV</button></div><div className="panel table-panel"><div className="table-toolbar"><div className="search-box">⌕ <input placeholder="Search by request, asset or location" /></div><select><option>All statuses</option><option>Resolved</option><option>In progress</option></select><select><option>All workspaces</option><option>Industrial</option><option>Civic</option><option>Logistics</option></select></div><table><thead><tr><th>REQUEST ID</th><th>BRIDGE REQUEST</th><th>CONTEXT</th><th>STATUS</th><th>AGE</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><td><b className="mono">{row[0]}</b></td><td><strong>{row[1]}</strong></td><td>{row[2]}</td><td><span className={`table-status ${row[3].toLowerCase().replaceAll(' ', '-')}`}><i />{row[3]}</span></td><td>{row[4]}</td><td className="row-action">•••</td></tr>)}</tbody></table></div></section> }

function PanelHeader({ title, meta }: { title: string; meta: string }) { return <div className="panel-header"><h3>{title}</h3><span>{meta}</span></div> }
function QueueItem({ severity, title, detail, age }: { severity: string; title: string; detail: string; age: string }) { return <div className="queue-item"><span className={`severity-bar ${severity}`} /><div><b>{title}</b><small>{detail}</small></div><time>{age}</time></div> }
function LoopStep({ number, label, sub, active }: { number: string; label: string; sub: string; active?: boolean }) { return <div className={`loop-step ${active ? 'active' : ''}`}><span>{number}</span><b>{label}</b><small>{sub}</small></div> }
function Step({ label, number, active, done }: { label: string; number: string; active: boolean; done: boolean }) { return <div className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`}><span>{done ? '✓' : number}</span><b>{label}</b></div> }
function Entity({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="entity"><span>{label}</span><b className={danger ? 'danger-text' : ''}>{value}</b></div> }
function EmptyState({ label }: { label: string }) { return <div className="empty-state"><span>⇄</span><p>{label}</p></div> }
function Audit({ time, label, detail, done, active }: { time: string; label: string; detail: string; done: boolean; active?: boolean }) { return <div className={`audit-row ${active ? 'active' : ''}`}><time>{time}</time><span className={`audit-dot ${done ? 'done' : ''}`}>{done ? '✓' : '·'}</span><div><b>{label}</b><small>{detail}</small></div></div> }
