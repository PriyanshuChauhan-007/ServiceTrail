import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Gauge,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Thermometer,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import './App.css'

type View = 'dashboard' | 'intake' | 'control' | 'checklist'

type Incident = {
  id: string
  asset: string
  title: string
  area: string
  status: 'Critical' | 'Warning' | 'Monitoring' | 'Resolved'
  priority: string
  temperature: number
  limit: number
  reported: string
  owner: string
}

const incidents: Incident[] = [
  {
    id: 'INC-2408',
    asset: 'MCH-04',
    title: 'Motor thermal overload',
    area: 'Line B · Pressing',
    status: 'Critical',
    priority: 'P0',
    temperature: 108,
    limit: 80,
    reported: '2 min ago',
    owner: 'Electrical',
  },
  {
    id: 'INC-2407',
    asset: 'MCH-02',
    title: 'Hydraulic pressure drift',
    area: 'Line A · Forming',
    status: 'Warning',
    priority: 'P1',
    temperature: 71,
    limit: 85,
    reported: '18 min ago',
    owner: 'Mechanical',
  },
  {
    id: 'INC-2405',
    asset: 'MCH-07',
    title: 'Vibration above baseline',
    area: 'Line C · Welding',
    status: 'Monitoring',
    priority: 'P2',
    temperature: 64,
    limit: 80,
    reported: '41 min ago',
    owner: 'Reliability',
  },
  {
    id: 'INC-2401',
    asset: 'MCH-01',
    title: 'Coolant flow restored',
    area: 'Line A · Forming',
    status: 'Resolved',
    priority: 'P3',
    temperature: 62,
    limit: 80,
    reported: '1 hr ago',
    owner: 'Utilities',
  },
]

const navigation: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Operations dashboard', icon: LayoutDashboard },
  { id: 'intake', label: 'Frontline intake', icon: MessageSquareText },
  { id: 'control', label: 'Control room', icon: Radio },
  { id: 'checklist', label: 'Action checklist', icon: ShieldCheck },
]

function StatusBadge({ status }: { status: Incident['status'] }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span />{status}</span>
}

function App() {
  const [view, setView] = useState<View>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedIncident, setSelectedIncident] = useState<Incident>(incidents[0])
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [filter, setFilter] = useState<'All' | Incident['status']>('All')

  const visibleIncidents = useMemo(
    () => filter === 'All' ? incidents : incidents.filter((incident) => incident.status === filter),
    [filter],
  )

  const selectIncident = (incident: Incident) => {
    setSelectedIncident(incident)
    setView('control')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <div className="brand-row">
          <div className="brand-mark"><Zap size={17} fill="currentColor" /></div>
          {sidebarOpen && <div><div className="brand-name">OpsBridge</div><div className="brand-subtitle">Industrial response OS</div></div>}
          {sidebarOpen && <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen(false)} aria-label="Collapse navigation"><PanelLeftClose size={17} /></button>}
        </div>
        {!sidebarOpen && <button className="icon-button expand-button" onClick={() => setSidebarOpen(true)} aria-label="Expand navigation"><Menu size={18} /></button>}
        {sidebarOpen && <div className="plant-switcher"><div className="plant-icon"><Activity size={16} /></div><div className="plant-info"><span className="eyebrow">Active plant</span><strong>Plant 04 · Pune</strong></div><ChevronDown size={15} /></div>}
        <div className="sidebar-label">Workspace</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? 'nav-active' : ''}`} onClick={() => setView(id)} title={label}>
              <Icon size={18} /><span>{sidebarOpen && label}</span>{sidebarOpen && id === 'control' && <span className="nav-count">3</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-label">System</div>
          <button className="nav-item"><Settings2 size={18} /><span>{sidebarOpen && 'Plant settings'}</span></button>
          <button className="nav-item"><CircleHelp size={18} /><span>{sidebarOpen && 'Response guide'}</span></button>
          {sidebarOpen && <div className="operator-card"><div className="avatar">RK</div><div><strong>Ravi Kumar</strong><span>Control engineer</span></div><div className="online-dot" /></div>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Plant 04</span><span>/</span><strong>{navigation.find((item) => item.id === view)?.label}</strong></div>
          <div className="topbar-actions"><div className="system-live"><span className="live-dot" /> All systems operational</div><button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><span>3</span></button><div className="top-avatar">RK</div></div>
        </header>

        {view === 'dashboard' ? (
          <DashboardContent incidents={visibleIncidents} filter={filter} setFilter={setFilter} onSelect={selectIncident} onOpenInspector={() => setInspectorOpen(true)} />
        ) : (
          <section className="subscreen"><div className="subscreen-icon"><Wrench size={26} /></div><p className="eyebrow">Next module</p><h1>{navigation.find((item) => item.id === view)?.label}</h1><p className="subscreen-copy">The navigation shell is ready. This workflow will be added next without changing your plant context or active incident.</p><button className="primary-button" onClick={() => setView('dashboard')}><LayoutDashboard size={16} /> Return to dashboard</button></section>
        )}
      </main>

      {inspectorOpen && <div className="drawer-backdrop" onClick={() => setInspectorOpen(false)}><aside className="contract-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><div className="eyebrow">Live data contract</div><h2>Universal incident record</h2></div><button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><X size={18} /></button></div><p className="drawer-copy">The frontend is reading the same normalized record that moves between frontline, control room, and action execution.</p><pre className="json-view">{JSON.stringify({ incident_id: selectedIncident.id, asset_id: selectedIncident.asset, fault_mode: selectedIncident.title, urgency: selectedIncident.priority, status: selectedIncident.status.toLowerCase(), telemetry: { temperature_c: selectedIncident.temperature, alarm_limit_c: selectedIncident.limit }, suggested_team: selectedIncident.owner }, null, 2)}</pre><div className="drawer-footer"><CheckCircle2 size={15} /> Contract validated · v0.1</div></aside></div>}
    </div>
  )
}

function DashboardContent({ incidents: filteredIncidents, filter, setFilter, onSelect, onOpenInspector }: { incidents: Incident[]; filter: 'All' | Incident['status']; setFilter: (filter: 'All' | Incident['status']) => void; onSelect: (incident: Incident) => void; onOpenInspector: () => void }) {
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow heading-kicker"><span className="live-dot" /> Live operations</div><h1>Good morning, Ravi.</h1><p>Here is the current health of Plant 04 and its active response queue.</p></div><div className="heading-actions"><button className="secondary-button" onClick={onOpenInspector}><Activity size={16} /> Inspect data contract</button><button className="primary-button" onClick={() => onSelect(incidents[0])}><MessageSquareText size={16} /> Open priority incident</button></div></div>
    <div className="metric-grid">
      <MetricCard label="Active incidents" value="03" detail="1 critical · 2 under watch" tone="red" icon={<AlertTriangle size={18} />} />
      <MetricCard label="Plant availability" value="96.8%" detail="+1.4% vs. previous shift" tone="green" icon={<Gauge size={18} />} />
      <MetricCard label="Downtime prevented" value="₹92,400" detail="This shift · 38.5 min recovered" tone="blue" icon={<Clock3 size={18} />} />
      <MetricCard label="Mean response time" value="04:18" detail="Target < 05:00 · on track" tone="amber" icon={<Zap size={18} />} />
    </div>
    <div className="dashboard-grid"><section className="panel incident-panel"><div className="panel-header"><div><div className="panel-title">Response queue</div><div className="panel-caption">Prioritized by operational impact and urgency</div></div><div className="filter-tabs">{(['All', 'Critical', 'Warning', 'Monitoring'] as const).map((item) => <button key={item} className={filter === item ? 'filter-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="incident-table-wrap"><table><thead><tr><th>Incident</th><th>Asset / area</th><th>Signal</th><th>Owner</th><th>Status</th><th /></tr></thead><tbody>{filteredIncidents.map((incident) => <tr key={incident.id} onClick={() => onSelect(incident)}><td><div className="incident-id">{incident.id}<span className={`priority priority-${incident.priority.toLowerCase()}`}>{incident.priority}</span></div><strong>{incident.title}</strong><span className="muted-line">Reported {incident.reported}</span></td><td><strong>{incident.asset}</strong><span className="muted-line">{incident.area}</span></td><td><div className={`signal ${incident.status.toLowerCase()}`}><Thermometer size={14} /> {incident.temperature}°C <span>/ {incident.limit}°</span></div></td><td><span className="owner"><span className="owner-dot" />{incident.owner}</span></td><td><StatusBadge status={incident.status} /></td><td><ChevronDown size={16} className="row-chevron" /></td></tr>)}</tbody></table></div></section><aside className="panel side-panel"><div className="panel-header"><div><div className="panel-title">Plant pulse</div><div className="panel-caption">Last 60 minutes · normalized health</div></div><button className="icon-button"><Search size={16} /></button></div><div className="pulse-score"><div className="score-ring"><strong>94</strong><span>/100</span></div><div><strong>Healthy with attention</strong><p>One asset needs immediate review.</p></div></div><div className="pulse-chart"><div className="chart-gridlines" /><svg viewBox="0 0 360 110" preserveAspectRatio="none" role="img" aria-label="Plant health trend"><path d="M0,76 C22,70 26,78 47,61 S81,65 103,50 S135,57 156,44 S188,47 210,39 S241,45 261,31 S298,45 316,27 S341,31 360,18" fill="none" stroke="#39d98a" strokeWidth="3" /><path d="M0,76 C22,70 26,78 47,61 S81,65 103,50 S135,57 156,44 S188,47 210,39 S241,45 261,31 S298,45 316,27 S341,31 360,18 V110 H0Z" fill="url(#pulseFill)" opacity=".18" /><defs><linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#39d98a" /><stop offset="1" stopColor="#39d98a" stopOpacity="0" /></linearGradient></defs></svg></div><div className="pulse-legend"><span><i className="legend-green" /> Nominal</span><span>Updated 30 sec ago</span></div><div className="attention-callout"><div className="callout-icon"><AlertTriangle size={15} /></div><div><strong>MCH-04 requires approval</strong><p>Motor is 28°C above its safe operating limit.</p></div></div></aside></div>
    <div className="bottom-strip"><div><span className="eyebrow">Shift handover</span><strong>Morning shift · 06:00 — 14:00</strong></div><div className="handover-stat"><CheckCircle2 size={17} /><span><strong>12</strong> resolved today</span></div><div className="handover-stat"><Activity size={17} /><span><strong>4 / 4</strong> lines producing</span></div><div className="handover-stat"><Clock3 size={17} /><span>Next review <strong>in 22 min</strong></span></div></div>
  </div>
}

function MetricCard({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: string; icon: ReactNode }) { return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span>{label}</span><div className="metric-icon">{icon}</div></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div> }

export default App
