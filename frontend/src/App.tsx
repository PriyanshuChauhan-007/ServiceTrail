import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, NetworkError } from './api'
import Auth from './Auth'
import About from './About'
import Admin from './Admin'
import Assets from './Assets'
import Dashboard from './Dashboard'
import Drafts from './Drafts'
import IncidentDetail from './IncidentDetail'
import Integrations from './Integrations'
import OfflineAccess from './OfflineAccess'
import OfflineWorkspace from './OfflineWorkspace'
import { MetricsView, Notifications, WorkMethods } from './Operations'
import Queue from './Queue'
import ReportEditor from './ReportEditor'
import Security from './Security'
import { Brand, Empty, ErrorNotice, Icon, Loading, confirmNavigation } from './components'
import { errorMessage, isReviewer } from './logic'
import { sameDeviceIdentity } from './deviceContext'
import { cacheAssets, clearOfflineData, isVaultUnlocked, listDrafts, lockVault, readCachedAssets, registerOfflineShell, vaultStatus } from './offline'
import type { Asset, Incident, Perspective, User } from './types'

type View = 'queue' | 'assets' | 'report' | 'drafts' | 'admin' | 'incident' | 'security' | 'notifications' | 'metrics' | 'methods' | 'integrations' | 'dashboard' | 'about'
export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [deviceUser, setDeviceUser] = useState<User | null>(null)
  const [offlineAccess, setOfflineAccess] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [sharedAvailable, setSharedAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [networkFailure, setNetworkFailure] = useState(false)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('opsbridge-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('opsbridge-theme', theme) } catch { /* Theme still works without persistence. */ } }, [theme])
  useEffect(() => { if (import.meta.env.PROD) registerOfflineShell() }, [])
  const boot = useCallback(async () => {
    setLoading(true); setError(''); setNetworkFailure(false)
    try {
      const status = await api.setupStatus(); setNeedsSetup(status.needs_setup); setSharedAvailable(status.demo_available === true)
      if (!status.needs_setup) {
        try { setUser((await api.me()).user) } catch (e) { if (!(e instanceof ApiError && e.status === 401)) throw e; setUser(null) }
      }
    } catch (e) { setError(errorMessage(e)); setNetworkFailure(e instanceof NetworkError) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void boot() }, [boot])
  function authenticated(value: User) { if (user && !sameDeviceIdentity(user, value)) lockVault(user.id); setNeedsSetup(false); setUser(value); setError('') }
  function signedOut() { if (user) lockVault(user.id); setUser(null) }
  const toggleTheme = () => setTheme(old => old === 'light' ? 'dark' : 'light')
  if (loading) return <main className="boot-screen"><Brand /><Loading text="Connecting to your operations workspace…" /></main>
  if (deviceUser) return <OfflineWorkspace user={deviceUser} onRevalidated={value => { lockVault(deviceUser.id); setDeviceUser(null); setOfflineAccess(false); authenticated(value) }} onExit={() => { lockVault(deviceUser.id); setDeviceUser(null); setOfflineAccess(false) }} />
  if (offlineAccess) return <OfflineAccess onUnlocked={setDeviceUser} onBack={() => setOfflineAccess(false)} />
  if (error) return <main className="boot-screen"><Brand /><div className="boot-error"><ErrorNotice message={error}><p>Identity must be confirmed by the server before opening site records.</p><button className="button primary" onClick={boot}>Retry connection</button>{networkFailure && <button className="button secondary" onClick={() => setOfflineAccess(true)}>Unlock device vault for offline drafts</button>}</ErrorNotice></div></main>
  return <><a className="skip-link" href="#main-content">Skip to main content</a>{user ? <Workspace key={`${user.id}:${user.site_id}`} user={user} sharedAvailable={sharedAvailable} theme={theme} onToggleTheme={toggleTheme} onSignedOut={signedOut} onUserChanged={authenticated} /> : <><button className="auth-theme button secondary small" onClick={toggleTheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />{theme === 'light' ? 'Dark' : 'Light'} mode</button><Auth setup={needsSetup} sharedAvailable={sharedAvailable} onAuthenticated={authenticated} /></>}</>
}

function Workspace({ user, sharedAvailable, theme, onToggleTheme, onSignedOut, onUserChanged }: { user: User; sharedAvailable: boolean; theme: string; onToggleTheme: () => void; onSignedOut: () => void; onUserChanged: (user: User) => void }) {
  const [view, setView] = useState<View>('queue')
  const [assets, setAssets] = useState<Asset[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [incidentId, setIncidentId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cachedAssets, setCachedAssets] = useState(false)
  const [assetsConfirmed, setAssetsConfirmed] = useState(false)
  const [usersConfirmed, setUsersConfirmed] = useState(false)
  const [draftCount, setDraftCount] = useState<number | null>(null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [clearOnLogout, setClearOnLogout] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const reviewer = isReviewer(user)
  const [perspectives, setPerspectives] = useState<Perspective[] | null>(null)
  const refreshDrafts = useCallback(() => { if (!isVaultUnlocked(user.id)) { setDraftCount(null); return } listDrafts(user.id).then(values => setDraftCount(values.length)).catch(() => setDraftCount(null)) }, [user.id])
  const refresh = useCallback(async () => {
    if (user.must_change_password) { setLoading(false); return }
    setRefreshing(true); setError(''); setNotice('')
    const problems: string[] = []
    await Promise.all([
      (async () => {
        try { const values = await api.assets(); setAssets(values); setAssetsConfirmed(true); setCachedAssets(false); if (await vaultStatus(user.id) === 'unlocked') { try { await cacheAssets(user.id, values) } catch { problems.push('Asset register loaded, but encrypted device caching failed.') } } }
        catch (e) {
          problems.push(`Assets: ${errorMessage(e)}`)
          if (e instanceof NetworkError && isVaultUnlocked(user.id)) { try { const values = await readCachedAssets(user.id); if (values.length) { setAssets(values as Asset[]); setCachedAssets(true); setAssetsConfirmed(false) } } catch { problems.push('Encrypted cached assets could not be read.') } }
        }
      })(),
      (async () => { if (reviewer) { try { setUsers((await api.users()).filter(person => person.site_id === user.site_id)); setUsersConfirmed(true) } catch (e) { problems.push(`Team directory: ${errorMessage(e)}`) } } })(),
    ])
    setError(problems.join(' ')); setRefreshing(false); setLoading(false); refreshDrafts(); setRevision(value => value + 1)
  }, [user.id, user.site_id, user.must_change_password, reviewer, refreshDrafts])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    let active = true
    setPerspectives(null)
    api.perspectives().then(value => { if (active) setPerspectives(value) }).catch(() => { if (active) setPerspectives(null) })
    return () => { active = false }
  }, [user.id, user.role])
  useEffect(() => { document.getElementById('main-content')?.focus(); window.scrollTo({ top: 0, behavior: 'instant' }) }, [view, incidentId])
  function navigate(next: View, saved = false) { if (!saved && !confirmNavigation()) return; setView(next); setLogoutOpen(false); setNotice('') }
  function updated(_value: Incident) { setRevision(value => value + 1) }
  function openIncident(id: string, saved = false) { if (!saved && !confirmNavigation()) return; setIncidentId(id); navigate('incident', true) }
  function report(id = '') { if (!confirmNavigation()) return; setAssetId(id); navigate('report', true) }
  async function logout() {
    if (!confirmNavigation()) return
    setLogoutBusy(true); setError('')
    try {
      if (clearOnLogout) await clearOfflineData(user.id);
      await api.logout();
    } catch {
      // Complete client logout even if session was expired
    } finally {
      lockVault(user.id);
      setLogoutBusy(false);
      onSignedOut();
    }
  }
  async function vaultChanged() { refreshDrafts(); if (isVaultUnlocked(user.id) && assetsConfirmed && !cachedAssets) { try { await cacheAssets(user.id, assets) } catch (e) { setError(`Device cache: ${errorMessage(e)}`) } } }
  const security = <Security user={user} onUserChanged={onUserChanged} onSignedOut={() => { lockVault(user.id); onSignedOut() }} onVaultChanged={() => void vaultChanged()} />
  const nav = (next: View, title: string, icon: 'book' | 'grid' | 'asset' | 'people' | 'plus' = 'book') => <button aria-current={view === next ? 'page' : undefined} onClick={() => navigate(next)}><Icon name={icon} /><span>{title}</span></button>
  return <div className={`app-shell ${reviewer ? 'desk-workspace' : 'field-workspace'}`}>
    <aside className="sidebar"><div className="sidebar-top"><Brand /><div className="workspace-label"><span className="live-dot" />{reviewer ? 'OPERATIONS DESK' : 'FIELD NOTEBOOK'}</div></div>
      <nav className="main-nav" aria-label="Workspace">{!user.must_change_password && <>{nav('queue', reviewer ? 'Work register' : 'My notebook', reviewer ? 'grid' : 'book')}{['worker', 'admin'].includes(user.role) && <button aria-current={view === 'report' ? 'page' : undefined} onClick={() => report()}><Icon name="plus" /><span>New field report</span></button>}{nav('assets', 'Asset register', 'asset')}{nav('drafts', `Device drafts${draftCount !== null ? ` · ${draftCount}` : ''}`)}{nav('notifications', 'Notifications')}{reviewer && <>{nav('methods', 'Work methods')}{nav('dashboard', 'Site dashboard', 'grid')}{nav('metrics', 'Operations metrics', 'grid')}</>}{user.role === 'admin' && <>{nav('admin', 'Site & team', 'people')}{nav('integrations', 'Inbound sources', 'asset')}</>}</>}{nav('security', 'Account security')}{nav('about', 'About OpsBridge', 'book')}</nav>
      <div className="sidebar-principle"><span className="eyebrow">THE OPERATING PRINCIPLE</span><p>Observe carefully.<br />Decide independently.<br />Leave a clear record.</p></div>
      <div className="sidebar-bottom">
        <button className="theme-toggle" onClick={onToggleTheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} /><span>{theme === 'light' ? 'Switch to dark' : 'Switch to light'}</span></button>
        <div className="identity">
          <span className="avatar">{user.name.split(' ').map(v => v[0]).slice(0, 2).join('')}</span>
          <div className="identity-info"><strong>{user.name}</strong><span>{user.role}</span></div>
          <button className="signout-btn" onClick={logout} title="Sign out of this device" aria-label="Sign out"><Icon name="logout" size={16} /><span>Sign out</span></button>
        </div>
      </div>
    </aside>
    <div className="workspace-body"><header className="workspace-topbar"><div><span className="topbar-org">{user.organization_name}</span><span className="topbar-divider">/</span><span>{user.site_name}</span></div><div className="topbar-right"><span className="topbar-context">{reviewer ? 'SOURCE → REVIEW → RELEASE' : 'OBSERVE → RECORD → HAND OFF'}</span>{perspectives && perspectives.length > 0 && <PerspectiveControl options={perspectives} current={user.role} onChanged={onUserChanged} />}</div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {sharedAvailable && <p className="notice" role="status"><strong>Shared workspace</strong> · Records are examples, not real operations. Edits are shared.</p>}
        {logoutOpen && <section className="panel signout-panel"><h2>Before you leave this device</h2><p>{draftCount === null ? 'The vault is locked or its draft count is unavailable. Local records are kept unless you explicitly clear them.' : `${draftCount} unsynced drafts on this device.`} Signing out does not submit them.</p><label className="checkbox-label"><input type="checkbox" checked={clearOnLogout} onChange={e => setClearOnLogout(e.target.checked)} />Clear my device drafts and cached assets when signing out. Unsynced work will be deleted.</label><div className="form-actions"><button className="button secondary" onClick={() => setLogoutOpen(false)}>Stay signed in</button><button className="button primary" disabled={logoutBusy} onClick={logout}>{logoutBusy ? 'Signing out…' : clearOnLogout ? 'Clear device data & sign out' : 'Keep device records & sign out'}</button></div></section>}
        {error && <ErrorNotice message={error}><button className="text-button" onClick={refresh} disabled={refreshing}>Retry workspace connection →</button></ErrorNotice>}
        {cachedAssets && <div className="notice warning" role="status">Using encrypted cached assets after network loss. Their status may be stale. No approved incident records are cached. A new report may be saved explicitly as a device draft after a failed network submission.</div>}
        {notice && <p className="notice success" role="status">{notice}</p>}
        {user.must_change_password || view === 'security' ? security : loading ? <Loading /> : <>
          {user.role === 'admin' && assetsConfirmed && usersConfirmed && (!assets.length || users.length < 2) && view === 'queue' && <section className="first-run-banner"><div><p className="eyebrow">FIRST-RUN SETUP</p><h2>Lay the groundwork for your first report.</h2><p>{!assets.length ? 'Start by registering your equipment. ' : ''}{users.length < 2 ? 'Create a separate worker and engineer so review stays independent.' : 'Your team is ready to capture observations.'}</p></div><button className="button secondary" onClick={() => navigate('admin')}>Set up the site<Icon name="arrow" size={18} /></button></section>}
          {view === 'queue' && <Queue user={user} onOpen={openIncident} onReport={() => report()} revision={revision} />}
          {view === 'assets' && (assetsConfirmed ? <Assets assets={assets} user={user} onCreated={value => { const next = [...assets, value]; setAssets(next); if (isVaultUnlocked(user.id)) cacheAssets(user.id, next).catch(() => setNotice('Asset registered, but encrypted device caching failed.')) }} onReport={report} /> : <Unavailable label="Live asset register" onRetry={refresh} busy={refreshing} />)}
          {view === 'admin' && user.role === 'admin' && (usersConfirmed && assetsConfirmed ? <Admin user={user} users={users} hasAssets={assets.length > 0} onAssets={() => navigate('assets')} onCreated={value => setUsers(old => [...old, value])} onChanged={value => setUsers(old => old.map(person => person.id === value.id ? value : person))} onSiteChanged={value => { lockVault(user.id); onUserChanged(value) }} /> : <Unavailable label="Site setup records" onRetry={refresh} busy={refreshing} />)}
          {view === 'report' && (assetsConfirmed || cachedAssets ? <ReportEditor key={assetId} user={user} assets={assets} assetId={assetId} onSaved={value => { updated(value); openIncident(value.id, true) }} onCancel={() => navigate('queue', true)} onDraftSaved={refreshDrafts} /> : <Unavailable label="Registered assets for reporting" onRetry={refresh} busy={refreshing} />)}
          {view === 'drafts' && <Drafts user={user} assets={assetsConfirmed ? assets : []} onSynced={updated} onChanged={refreshDrafts} />}
          {view === 'incident' && <IncidentDetail key={incidentId} id={incidentId} user={user} users={users} assets={assets} onBack={() => navigate('queue')} onUpdated={updated} />}
          {view === 'notifications' && <Notifications onOpen={openIncident} />}
          {view === 'methods' && reviewer && <WorkMethods />}
          {view === 'dashboard' && reviewer && <Dashboard />}
          {view === 'metrics' && reviewer && <MetricsView />}
          {view === 'integrations' && user.role === 'admin' && <Integrations />}
          {view === 'about' && <About />}
        </>}
      </main><footer className="workspace-footer"><Brand compact /><span>{user.site_name} · Accountable manufacturing operations</span><span>No observation is a verified diagnosis.</span></footer>
    </div>
  </div>
}

function PerspectiveControl({ options, current, onChanged }: { options: Perspective[]; current: User['role']; onChanged: (user: User) => void }) {
  const [selected, setSelected] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function apply() {
    if (!confirmNavigation()) return
    setBusy(true); setError('')
    try { onChanged((await api.switchPerspective(selected)).user) }
    catch (e) {
      setError(errorMessage(e))
      // A dropped response may follow a committed cookie change. Reconcile with
      // the server without repeating the switch or keeping an assumed identity.
      try { onChanged((await api.me()).user) } catch { /* Preserve the failure message. */ }
    }
    finally { setBusy(false) }
  }
  return <div className="perspective-control"><label>View as<select value={selected} onChange={event => setSelected(event.target.value as User['role'])} disabled={busy}>{options.map(option => <option key={option.key} value={option.key}>{option.name} · {option.role}</option>)}</select></label><button className="button secondary small" onClick={apply} disabled={busy || selected === current}>{busy ? 'Applying…' : 'Apply'}</button>{error && <span className="field-help" role="alert">{error}</span>}</div>
}

function Unavailable({ label, onRetry, busy }: { label: string; onRetry: () => void; busy: boolean }) {
  return <section className="panel"><Empty title={`${label} could not be loaded.`}><p>No empty-state or count has been assumed. Reconnect to confirm current site records.</p><button className="button secondary" onClick={onRetry} disabled={busy}>{busy ? 'Connecting…' : 'Retry connection'}</button></Empty></section>
}
