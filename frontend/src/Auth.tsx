import { useState, type FormEvent } from 'react'
import { api } from './api'
import { Brand, ErrorNotice, Icon } from './components'
import { errorMessage } from './logic'
import type { User } from './types'

export default function Auth({ setup, onAuthenticated }: { setup: boolean; onAuthenticated: (user: User) => void }) {
  const [name, setName] = useState('Priyanshu Chauhan')
  const [organization, setOrganization] = useState('')
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reset, setReset] = useState(false)
  const [token, setToken] = useState('')
  const [otp, setOtp] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [notice, setNotice] = useState('')

  async function quickLogin(demoEmail: string, demoPass: string) {
    setEmail(demoEmail)
    setPassword(demoPass)
    setOtp('')
    setRecovery(false)
    setError('')
    setBusy(true)
    try {
      if (setup) {
        try { await api.seedDemo() } catch { /* ignore if already seeded */ }
      }
      const result = await api.login(demoEmail, demoPass)
      onAuthenticated(result.user)
    } catch (e) {
      try {
        await api.seedDemo()
        const retry = await api.login(demoEmail, demoPass)
        onAuthenticated(retry.user)
      } catch {
        setError(errorMessage(e))
      }
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (reset) { await api.resetPassword(token.trim(), password); setToken(''); setPassword(''); setReset(false); setNotice('Password reset confirmed. Sign in with the new password and your existing MFA, if enrolled.'); return }
      const result = setup ? await api.setup({ organization_name: organization.trim(), site_name: site.trim(), name: name.trim(), email: email.trim(), password }) : await api.login(email.trim(), password, recovery ? undefined : otp.trim() || undefined, recovery ? otp.trim() || undefined : undefined); onAuthenticated(result.user)
    }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <main id="main-content" className="auth-layout" tabIndex={-1}>
    <section className="auth-story"><Brand /><div className="auth-statement"><p className="eyebrow">FROM THE FLOOR. TO A CLEAR DECISION.</p><h1>Good operations<br />start with the<br /><em>whole story.</em></h1><p>A shared record of the asset, the observation, and the people accountable for what happens next.</p></div><div className="auth-foot"><span>01 / Observe</span><span>02 / Review</span><span>03 / Verify</span></div></section>
    <section className="auth-form"><div className="auth-form-inner"><p className="eyebrow">{setup ? 'YOUR FIRST SHIFT WITH OPSBRIDGE' : reset ? 'ACCOUNT RECOVERY / ONE-USE TOKEN' : 'WELCOME BACK'}</p><h2>{setup ? 'Set up your operations.' : reset ? 'Reset your password.' : 'Your workspace awaits.'}</h2><p className="muted">{setup ? 'Create your site and first administrator, or click any Demo Role below to tour pre-seeded operations.' : reset ? 'Use the token delivered directly by your administrator. Existing MFA remains required at the next sign-in.' : 'Sign in with the account your site administrator created.'}</p>
      <form onSubmit={submit} className="form-stack">
        {setup && <><label>Organization<input required value={organization} onChange={e => setOrganization(e.target.value)} autoComplete="organization" placeholder="Organization name" maxLength={160} /></label><label>Site<input required value={site} onChange={e => setSite(e.target.value)} placeholder="e.g. North manufacturing plant" maxLength={160} /></label><label>Your full name<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={160} /></label></>}
        {reset ? <label>Administrator-issued reset token<input required autoComplete="off" type="password" value={token} onChange={e => setToken(e.target.value)} /><span className="field-help">Ask your administrator to deliver a one-use token directly. It is never sent by this application as email.</span></label> : <label>Work email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@organization.com" /></label>}
        <label>{reset ? 'New password' : 'Password'}<input type="password" required minLength={setup || reset ? 12 : undefined} autoComplete={setup || reset ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} aria-describedby="password-hint" /></label>
        {!setup && !reset && <><label>{recovery ? 'One-use recovery code' : 'Authenticator code (if enrolled)'}<input autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value)} inputMode={recovery ? 'text' : 'numeric'} /></label><label className="checkbox-label"><input type="checkbox" checked={recovery} onChange={e => { setRecovery(e.target.checked); setOtp('') }} />Use a recovery code instead of an authenticator code</label></>}
        <p id="password-hint" className="field-help">{setup ? 'Use at least 12 characters, or choose a 1-click Demo Role below.' : 'Need access? Ask your site administrator to create an account.'}</p>
        {!reset && (
          <div className="auth-demo-strip">
            <div className="auth-demo-header">
              <span className="mono">DEMO ROLES · 1-CLICK TOUR</span>
              <span className="muted mono">Password: *Pass1234!</span>
            </div>
            <div className="auth-demo-grid">
              <button type="button" className="auth-demo-btn" disabled={busy} onClick={() => void quickLogin('worker@apex.local', 'WorkerPass1234!')}>
                <span className="auth-demo-role">Technician</span>
                <span className="auth-demo-email mono">worker@apex.local</span>
              </button>
              <button type="button" className="auth-demo-btn" disabled={busy} onClick={() => void quickLogin('engineer@apex.local', 'EngineerPass1234!')}>
                <span className="auth-demo-role">Reliability Engineer</span>
                <span className="auth-demo-email mono">engineer@apex.local</span>
              </button>
              <button type="button" className="auth-demo-btn" disabled={busy} onClick={() => void quickLogin('supervisor@apex.local', 'SupervisorPass1234!')}>
                <span className="auth-demo-role">Operations Supervisor</span>
                <span className="auth-demo-email mono">supervisor@apex.local</span>
              </button>
              <button type="button" className="auth-demo-btn" disabled={busy} onClick={() => void quickLogin('admin@apex.local', 'AdminPass1234!')}>
                <span className="auth-demo-role">Site Administrator</span>
                <span className="auth-demo-email mono">admin@apex.local</span>
              </button>
            </div>
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        {notice && <p className="notice success" role="status">{notice}</p>}
        <button className="button primary wide" disabled={busy}>{busy ? 'Connecting…' : setup ? 'Create organization & enter' : reset ? 'Reset password' : 'Sign in securely'}<Icon name="arrow" /></button>
        {!setup && <button type="button" className="text-button" disabled={busy} onClick={() => { setReset(!reset); setPassword(''); setToken(''); setOtp(''); setError(''); setNotice('') }}>{reset ? 'Back to sign in' : 'Reset password with administrator token'}</button>}
      </form>
      <p className="auth-note">Account-based access · Decisions attributed to the signed-in person</p>
      <div className="auth-footer-meta">
        <a href="https://opsbridge-demo.onrender.com" target="_blank" rel="noreferrer">🌐 Live Demo</a>
        <span>·</span>
        <a href="https://github.com/PriyanshuChauhan-007/opsbridge" target="_blank" rel="noreferrer">🐙 GitHub Repo</a>
        <span>·</span>
        <span>By Priyanshu Chauhan</span>
      </div>
    </div></section>
  </main>
}
