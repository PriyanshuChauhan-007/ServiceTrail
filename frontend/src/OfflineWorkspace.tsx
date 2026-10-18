import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import Auth from './Auth'
import Drafts from './Drafts'
import ReportEditor from './ReportEditor'
import { Brand, ErrorNotice, Loading, confirmNavigation } from './components'
import { errorMessage } from './logic'
import { sameDeviceIdentity } from './deviceContext'
import { isVaultUnlocked, readCachedAssets } from './offline'
import type { Asset, User } from './types'

export default function OfflineWorkspace({ user, onRevalidated, onExit }: { user: User; onRevalidated: (user: User) => void; onExit: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [view, setView] = useState<'report' | 'drafts'>('report')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [signin, setSignin] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => { let active = true; readCachedAssets(user.id).then(values => { if (active) setAssets(values as Asset[]) }).catch(e => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [user.id])
  const matches = (value: User) => sameDeviceIdentity(user, value)
  async function revalidate() { if (!confirmNavigation()) return; setBusy(true); setError(''); try { const result = await api.me(); if (!matches(result.user)) { setError('The current server session belongs to a different account or site. Sign in as the cached account to sync its drafts.'); setSignin(true) } else onRevalidated(result.user) } catch (e) { if (e instanceof ApiError && e.status === 401) setSignin(true); else setError(errorMessage(e)) } finally { setBusy(false) } }
  if (signin) return <><div className="offline-identity notice warning"><strong>Revalidate {user.name} / {user.site_name}</strong><p>Use this cached account's server credentials. Unlocking the device did not authorize a server session.</p><button className="text-button" onClick={() => setSignin(false)}>Back to offline drafts</button>{error && <ErrorNotice message={error} />}</div><Auth setup={false} onAuthenticated={value => { if (matches(value)) onRevalidated(value); else { setError('Signed-in identity or site does not match this device context. Use the matching account before syncing these drafts.'); void api.logout().catch(() => setError('A different server identity was signed in. Sign out and sign in as the matching device account before syncing.')) } }} /></>
  return <div className="offline-workspace"><header className="workspace-topbar"><Brand /><span>DEVICE CONTEXT · NOT SERVER SIGN-IN</span></header><main id="main-content" className="main-content"><section className="panel"><p className="eyebrow">ENCRYPTED FIELD NOTEBOOK / OFFLINE</p><h1>{user.name} · device context</h1><p>{user.organization_name} / {user.site_name}. Cached identity and assets may be stale. This workspace permits draft capture only. No approved work is cached or released here.</p><div className="form-actions"><button className="button primary" disabled={busy} onClick={revalidate}>{busy ? 'Checking server identity…' : 'Reconnect & revalidate server session'}</button><button className="button secondary" onClick={() => { if (confirmNavigation()) setSignin(true) }}>Sign in to resume online</button><button className="button secondary" onClick={() => { if (confirmNavigation()) onExit() }}>Lock vault & leave device context</button></div></section>{error && <ErrorNotice message={error} />}<nav className="record-tabs" aria-label="Offline draft workspace"><button aria-current={view === 'report' ? 'page' : undefined} onClick={() => { if (confirmNavigation()) setView('report') }}>Capture device draft</button><button aria-current={view === 'drafts' ? 'page' : undefined} onClick={() => { if (confirmNavigation()) setView('drafts') }}>Saved device drafts</button></nav>{!isVaultUnlocked(user.id) ? <ErrorNotice message="Your vault has been locked. Leave this device context and unlock again to continue." /> : loading ? <Loading /> : view === 'report' ? <ReportEditor user={user} assets={assets} offlineConfirmed onSaved={() => undefined} onCancel={() => setView('drafts')} onDraftSaved={() => setRevision(v => v + 1)} /> : <Drafts key={revision} user={user} assets={assets} offlineOnly onSynced={() => undefined} onChanged={() => setRevision(v => v + 1)} />}</main></div>
}
