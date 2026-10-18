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
      const result = await api.login(demoEmail, demoPass)
      onAuthenticated(result.user)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function quickDemoSetup() {
    setBusy(true)
    setError('')
    try {
      try {
        await api.seedDemo()
        const result = await api.login('admin@apex.local', 'AdminPass1234!')
        onAuthenticated(result.user)
        return
      } catch {
        setOrganization('Apex Precision Dynamics')
        setSite('Plant Alpha - Machining Cell')
        setName('Priyanshu Chauhan')
        setEmail('admin@apex.local')
        setPassword('AdminPass1234!')
      }
    } catch (e) {
      setError(errorMessage(e))
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
    <section className="auth-form"><div className="auth-form-inner"><p className="eyebrow">{setup ? 'YOUR FIRST SHIFT WITH OPSBRIDGE' : reset ? 'ACCOUNT RECOVERY / ONE-USE TOKEN' : 'WELCOME BACK'}</p><h2>{setup ? 'Set up your operations.' : reset ? 'Reset your password.' : 'Your workspace awaits.'}</h2><p className="muted">{setup ? 'Create your site and first administrator. Then register real assets and invite your team.' : reset ? 'Use the token delivered directly by your administrator. Existing MFA remains required at the next sign-in.' : 'Sign in with the account your site administrator created.'}</p>
      {setup && (
        <div style={{ margin: '14px 0 10px', padding: '12px 14px', background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: '6px' }}>
          <span style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '4px' }}>
            Recruiter Demo Quick Start
          </span>
          <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            Explore instantly with sample industrial assets, work methods, and active incidents:
          </p>
          <button type="button" className="button secondary small wide" disabled={busy} onClick={() => void quickDemoSetup()}>
            Auto-configure Demo Data & Enter
          </button>
        </div>
      )}
      <form onSubmit={submit} className="form-stack">
        {setup && <><label>Organization<input required value={organization} onChange={e => setOrganization(e.target.value)} autoComplete="organization" placeholder="Organization name" maxLength={160} /></label><label>Site<input required value={site} onChange={e => setSite(e.target.value)} placeholder="e.g. North manufacturing plant" maxLength={160} /></label><label>Your full name<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={160} /></label></>}
        {reset ? <label>Administrator-issued reset token<input required autoComplete="off" type="password" value={token} onChange={e => setToken(e.target.value)} /><span className="field-help">Ask your administrator to deliver a one-use token directly. It is never sent by this application as email.</span></label> : <label>Work email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@organization.com" /></label>}
        <label>{reset ? 'New password' : 'Password'}<input type="password" required minLength={setup || reset ? 12 : undefined} autoComplete={setup || reset ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} aria-describedby="password-hint" /></label>
        {!setup && !reset && <><label>{recovery ? 'One-use recovery code' : 'Authenticator code (if enrolled)'}<input autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value)} inputMode={recovery ? 'text' : 'numeric'} /></label><label className="checkbox-label"><input type="checkbox" checked={recovery} onChange={e => { setRecovery(e.target.checked); setOtp('') }} />Use a recovery code instead of an authenticator code</label></>}
        <p id="password-hint" className="field-help">{setup ? 'Use at least 12 characters. This account is the site administrator.' : 'Need access? Ask your site administrator to create an account.'}</p>
        {!setup && !reset && (
          <div style={{ margin: '8px 0 14px', padding: '14px 14px', background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                Recruiter Demo Access · 1-Click Sign In
              </span>
              <span style={{ fontSize: '0.67rem', color: 'var(--muted)' }}>Pre-seeded</span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.4 }}>
              Click any account to immediately explore live shopfloor workflows:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 10px', minHeight: '44px', display: 'flex', flexDirection: 'column' }}
                onClick={() => void quickLogin('worker@apex.local', 'WorkerPass1234!')}
              >
                <span style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--heading)' }}>👷 Technician</span>
                <span style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>Marcus Vance (Worker)</span>
              </button>

              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 10px', minHeight: '44px', display: 'flex', flexDirection: 'column' }}
                onClick={() => void quickLogin('engineer@apex.local', 'EngineerPass1234!')}
              >
                <span style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--heading)' }}>⚙️ Reliability Eng.</span>
                <span style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>Sarah Lin (Approver)</span>
              </button>

              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 10px', minHeight: '44px', display: 'flex', flexDirection: 'column' }}
                onClick={() => void quickLogin('supervisor@apex.local', 'SupervisorPass1234!')}
              >
                <span style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--heading)' }}>📋 Ops Supervisor</span>
                <span style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>Elena Rostova (Reviewer)</span>
              </button>

              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '8px 10px', minHeight: '44px', display: 'flex', flexDirection: 'column' }}
                onClick={() => void quickLogin('admin@apex.local', 'AdminPass1234!')}
              >
                <span style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--heading)' }}>🔑 Site Admin</span>
                <span style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>Priyanshu Chauhan</span>
              </button>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.69rem', color: 'var(--muted)' }}>
              <span>Credentials: <code>*Pass1234!</code></span>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: '0.69rem', padding: 0 }}
                onClick={() => {
                  setEmail('worker@apex.local');
                  setPassword('WorkerPass1234!');
                  setOtp('');
                  setRecovery(false);
                }}
              >
                Fill form values
              </button>
            </div>
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        {notice && <p className="notice success" role="status">{notice}</p>}
        <button className="button primary wide" disabled={busy}>{busy ? 'Connecting…' : setup ? 'Create organization & enter' : reset ? 'Reset password' : 'Sign in securely'}<Icon name="arrow" /></button>
        {!setup && <button type="button" className="text-button" disabled={busy} onClick={() => { setReset(!reset); setPassword(''); setToken(''); setOtp(''); setError(''); setNotice('') }}>{reset ? 'Back to sign in' : 'Reset password with administrator token'}</button>}
      </form><p className="auth-note">Account-based access · Decisions attributed to the signed-in person</p>
    </div></section>
  </main>
}
