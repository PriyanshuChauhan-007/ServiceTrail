import { useState, type FormEvent } from 'react'
import { api } from './api'
import { Brand, ErrorNotice, Icon } from './components'
import { errorMessage } from './logic'
import type { User } from './types'

export default function Auth({ setup, sharedAvailable = false, onAuthenticated }: { setup: boolean; sharedAvailable?: boolean; onAuthenticated: (user: User) => void }) {
  const [name, setName] = useState('Priyanshu Chauhan')
  const [organization, setOrganization] = useState('')
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reset, setReset] = useState(false)
  const [token, setToken] = useState('')
  const [otp, setOtp] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [notice, setNotice] = useState('')
  const [accountSignIn, setAccountSignIn] = useState(false)
  const [registration, setRegistration] = useState(false)
  const sharedEntry = sharedAvailable && !setup && !reset && !accountSignIn && !registration

  function startSignIn() {
    setAccountSignIn(true); setRegistration(false); setReset(false); setError(''); setNotice('')
  }

  function startRegistration() {
    setAccountSignIn(false); setRegistration(true); setReset(false); setError(''); setNotice(''); setConfirmPassword('')
  }

  async function openWorkspace() {
    setBusy(true); setError('')
    try { onAuthenticated((await api.openWorkspace()).user) }
    catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (reset) { await api.resetPassword(token.trim(), password); setToken(''); setPassword(''); setReset(false); setNotice('Password reset confirmed. Sign in with the new password and your existing MFA, if enrolled.'); return }
      if (registration && password !== confirmPassword) { setError('Passwords do not match. Check both password fields and try again.'); return }
      const result = setup
        ? await api.setup({ organization_name: organization.trim(), site_name: site.trim(), name: name.trim(), email: email.trim(), password })
        : registration
          ? await api.register({ organization_name: organization.trim(), site_name: site.trim(), name: name.trim(), email: email.trim(), password })
          : await api.login(email.trim(), password, recovery ? undefined : otp.trim() || undefined, recovery ? otp.trim() || undefined : undefined)
      onAuthenticated(result.user)
    }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return <main id="main-content" className="auth-layout" tabIndex={-1}>
    <section className="auth-story"><Brand /><div className="auth-statement"><p className="eyebrow">EQUIPMENT INCIDENTS</p><h1>Report a fault.<br />Review the work.<br /><em>Check the result.</em></h1><p>Workers record what happened. Engineers ask questions and release work. Completion stays open until someone checks it.</p></div><div className="auth-foot"><span>01 / Report</span><span>02 / Review</span><span>03 / Verify</span></div></section>
    <section className="auth-form"><div className="auth-form-inner"><p className="eyebrow">{setup ? 'YOUR FIRST SERVICE DAY WITH SERVICETRAIL' : reset ? 'ACCOUNT RECOVERY / ONE-USE TOKEN' : registration ? 'NEW SERVICE WORKSPACE' : sharedEntry ? 'PUBLIC WORKSPACE' : 'WELCOME BACK'}</p><h2>{setup ? 'Set up your service company.' : reset ? 'Reset your password.' : registration ? 'Create a new workspace.' : sharedEntry ? 'Shared workspace' : 'Your service workspace awaits.'}</h2><p className="muted">{setup ? 'Create your company and first administrator. Then add customers, technicians, and service jobs.' : reset ? 'Use the token delivered directly by your administrator. Existing MFA remains required at the next sign-in.' : registration ? 'Start with one company, one service location, and an administrator account. Add customers and technicians after you enter.' : sharedEntry ? 'Records are examples, not real operations. Edits are shared.' : 'Sign in with the account your service company administrator created.'}</p>
      {sharedEntry ? <div className="form-stack">{error && <ErrorNotice message={error} />}<button className="button primary wide" disabled={busy} onClick={openWorkspace}>{busy ? 'Opening…' : 'Open workspace'}<Icon name="arrow" /></button><button className="text-button" disabled={busy} onClick={startSignIn}>Sign in to an account</button><button className="text-button" disabled={busy} onClick={startRegistration}>Create a new workspace</button></div> : <form onSubmit={submit} className="form-stack">
        {(setup || registration) && <><label>Organization<input required value={organization} onChange={e => setOrganization(e.target.value)} autoComplete="organization" placeholder="Organization name" maxLength={160} /></label><label>Site<input required value={site} onChange={e => setSite(e.target.value)} autoComplete="organization-title" placeholder="e.g. North manufacturing plant" maxLength={160} /></label><label>Your full name<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your name" maxLength={160} /></label></>}
        {reset ? <label>Administrator-issued reset token<input required autoComplete="off" type="password" value={token} onChange={e => setToken(e.target.value)} /><span className="field-help">Ask your administrator to deliver a one-use token directly. It is never sent by this application as email.</span></label> : <label>Work email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@organization.com" /></label>}
        <label>{reset ? 'New password' : 'Password'}<input type="password" required minLength={setup || reset || registration ? 12 : undefined} autoComplete={setup || reset || registration ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} aria-describedby="password-hint" /></label>
        {registration && <label>Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>}
        {!setup && !reset && !registration && <><label>{recovery ? 'One-use recovery code' : 'Authenticator code (if enrolled)'}<input autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value)} inputMode={recovery ? 'text' : 'numeric'} /></label><label className="checkbox-label"><input type="checkbox" checked={recovery} onChange={e => { setRecovery(e.target.checked); setOtp('') }} />Use a recovery code instead of an authenticator code</label></>}
        <p id="password-hint" className="field-help">{setup ? 'Use at least 12 characters. This account is the site administrator.' : registration ? 'Use at least 12 characters. This creates the first administrator for the new workspace; no invitation email is sent.' : 'Need access? Ask your site administrator to create an account.'}</p>
        {error && <ErrorNotice message={error} />}
        {notice && <p className="notice success" role="status">{notice}</p>}
        <button className="button primary wide" disabled={busy}>{busy ? 'Connecting…' : setup ? 'Create organization & enter' : registration ? 'Create workspace & enter' : reset ? 'Reset password' : 'Sign in securely'}<Icon name="arrow" /></button>
        {!setup && !registration && <button type="button" className="text-button" disabled={busy} onClick={() => { setReset(!reset); setPassword(''); setToken(''); setOtp(''); setError(''); setNotice('') }}>{reset ? 'Back to sign in' : 'Reset password with administrator token'}</button>}
        {!setup && !reset && !registration && <button type="button" className="text-button" disabled={busy} onClick={startRegistration}>Create a new workspace</button>}
        {!setup && registration && <button type="button" className="text-button" disabled={busy} onClick={startSignIn}>Back to sign in</button>}
      </form>}
    </div></section>
  </main>
}
