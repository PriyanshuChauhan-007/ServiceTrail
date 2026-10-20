import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import { Badge, Empty, ErrorNotice, Icon, Loading, confirmNavigation, useUnsavedChanges } from './components'
import { approvalGaps, canEdit, canExecute, dateTime, downloadJson, errorMessage, isReviewer, nextStep, readable, reviewStatuses, sourceVersion } from './logic'
import ReportEditor from './ReportEditor'
import type { Action, Asset, ChecklistItem, Incident, User, WorkMethod } from './types'

type Tab = 'source' | 'review' | 'work' | 'history' | 'revise'
export default function IncidentDetail({ id, user, users, assets, onBack, onUpdated }: { id: string; user: User; users: User[]; assets: Asset[]; onBack: () => void; onUpdated: (incident: Incident) => void }) {
  const [incident, setIncident] = useState<Incident | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('source')
  const [online, setOnline] = useState(navigator.onLine)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const onlineChange = () => setOnline(navigator.onLine)
    window.addEventListener('online', onlineChange); window.addEventListener('offline', onlineChange)
    return () => { window.removeEventListener('online', onlineChange); window.removeEventListener('offline', onlineChange) }
  }, [])
  useEffect(() => { let active = true; setLoading(true); setError(''); api.incident(id).then(value => { if (active) setIncident(value) }).catch(e => { if (active) setError(errorMessage(e)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [id])
  async function refresh() {
    if (!confirmNavigation()) return
    setBusy(true); setError('')
    try { const value = await api.incident(id); setIncident(value); onUpdated(value); setSuccess('Current server record loaded.') } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  function update(value: Incident) { if (!mounted.current) return; setIncident(value); onUpdated(value) }
  async function perform(operation: () => Promise<Incident>, message: string): Promise<boolean> {
    setBusy(true); setError(''); setSuccess('')
    try { update(await operation()); setSuccess(message); return true }
    catch (e) { setError(errorMessage(e)); return false } finally { setBusy(false) }
  }
  const action = (type: Action, note?: string, confirmed?: boolean, assigned?: string, method?: string) => incident ? perform(() => api.action(id, { action: type, version: incident.version, note, review_confirmed: confirmed, assigned_to: assigned, work_method_id: method }), type === 'analyze' ? 'Analysis recorded against the current report version.' : 'Action confirmed by the server. The record and timeline are updated.') : Promise.resolve(false)
  const goTab = (next: Tab) => { if (confirmNavigation()) setTab(next) }
  async function exportRecord() {
    setBusy(true); setError('')
    try { downloadJson(await api.export(id), `${incident?.number || 'incident'}-audit.json`); setSuccess('Audit JSON downloaded from the server.') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function exportCsv() {
    if (!incident) return
    setBusy(true); setError('')
    try { await api.exportCsv(id, `${incident.number}-audit.csv`); setSuccess('Audit CSV downloaded from the server.') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  if (loading) return <Loading text="Opening the source record…" />
  if (!incident) return <><button className="text-button" onClick={onBack}>← Back to register</button><ErrorNotice message={error || 'Incident unavailable.'}><button className="button secondary" onClick={refresh} disabled={busy}>Retry loading record</button></ErrorNotice></>
  const reviewer = isReviewer(user)
  const editable = canEdit(incident, user)
  const evidenceEditable = incident.reporter.id === user.id && ['submitted', 'needs_clarification', 'changes_requested', 'ready_for_review', 'under_review'].includes(incident.status)
  const executable = canExecute(incident, user)
  const disabled = busy || !online
  return <article className="incident-detail">
    <div className="detail-topbar"><button className="text-button" onClick={onBack}>← Work register</button><div><button className="button ghost small" onClick={refresh} disabled={busy}>Refresh source</button><button className="button secondary small" onClick={exportRecord} disabled={disabled}><Icon name="download" size={16} />Audit JSON</button><button className="button secondary small" onClick={exportCsv} disabled={disabled}><Icon name="download" size={16} />Audit CSV</button></div></div>
    <header className="incident-header"><div className="incident-title"><p className="eyebrow">INCIDENT RECORD <span className="mono">/ {incident.number}</span></p><h1>{incident.asset?.name || 'Asset report'}</h1><p className="asset-eyebrow">{incident.asset?.code} <span>/ {incident.asset?.area}</span></p></div><div className="detail-status"><Badge status={incident.status} /><span className="mono version-label">SOURCE v{sourceVersion(incident)} / RECORD r{incident.version}</span><span className={`priority priority-${incident.priority}`}>{incident.priority} priority</span></div></header>
    <div className="detail-metadata"><div><span>Reported by</span><strong>{incident.reporter.name}</strong></div><div><span>Created</span><strong>{dateTime(incident.created_at)}</strong></div><div><span>Assigned to</span><strong>{incident.assigned_to?.name || 'Not assigned'}</strong></div><div><span>Due</span><strong>{dateTime(incident.due_at)}</strong></div></div>
    <div className="next-step-banner"><span className="eyebrow">NEXT RESPONSIBILITY</span><strong>{nextStep(incident)}</strong></div>
    {!online && <div className="notice warning" role="status"><strong>Connection unavailable</strong><p>You are reading the last loaded server record. Review, approval, execution and verification require a live connection.</p></div>}
    {error && <ErrorNotice message={error}><p className="field-help">No local success was recorded. If the report changed elsewhere, refresh the source before deciding again.</p><button className="text-button" onClick={refresh} disabled={busy}>Load latest server record →</button></ErrorNotice>}
    {success && <p className="notice success" role="status">{success}</p>}
    <nav className="record-tabs" aria-label="Incident sections"><button aria-current={tab === 'source' ? 'page' : undefined} onClick={() => goTab('source')}>Source & evidence <span>{incident.evidence.length}</span></button><button aria-current={tab === 'review' ? 'page' : undefined} onClick={() => goTab('review')}>Analysis & decision</button><button aria-current={tab === 'work' ? 'page' : undefined} onClick={() => goTab('work')}>Released work <span>{incident.checklist.filter(s => s.completed).length}/{incident.checklist.length}</span></button><button aria-current={tab === 'history' ? 'page' : undefined} onClick={() => goTab('history')}>Activity trail <span>{incident.timeline.length}</span></button>{editable && <button aria-current={tab === 'revise' ? 'page' : undefined} onClick={() => goTab('revise')}>Revise report</button>}</nav>
    {tab === 'source' && <div className="detail-columns"><div><section className="panel source-document"><div className="document-top"><span className="eyebrow">SOURCE ACCOUNT / READ-ONLY</span><span className="mono">v{sourceVersion(incident)}</span></div><h2>The field observation</h2><p className="source-text">{incident.description}</p><div className="source-block"><h3>Operational impact</h3><p>{incident.impact || 'Not recorded'}</p></div><div className="source-block"><h3>Measurements & conditions</h3><p>{incident.measurements || 'No measurement provided. This is an outstanding information gap.'}</p><small>Worker-reported text · not independently sensor-verified</small></div><div className="safety-facts"><div><span>Injury statement</span><strong>{incident.injury_status === 'none' ? 'No injury reported' : readable(incident.injury_status)}</strong></div><div><span>Equipment state statement</span><strong>{readable(incident.safe_state)}</strong></div></div><footer className="document-footer"><span>Source: {incident.reporter.name}</span><span>Report version {sourceVersion(incident)} · unverified observation</span></footer>{editable && <button className="button secondary" onClick={() => setTab('revise')}>Clarify / revise source report<Icon name="arrow" size={16} /></button>}</section>
      <EvidencePanel incident={incident} editable={evidenceEditable} disabled={disabled} onUpload={file => perform(() => api.upload(id, file, incident.version), 'Evidence received. Review the updated report version and any invalidated analysis.')} />
    </div><aside><Findings incident={incident} /><section className="panel provenance-panel"><p className="eyebrow">PROVENANCE, NOT PROBABILITY</p><h3>What this record can establish</h3><p>The source is a person’s account. Attachments provide context. Rules can flag missing or contradictory information; they do not certify truth, compliance, or a diagnosis.</p><p>Reviewer decisions and work-step notes are recorded separately with the actor and report version.</p></section></aside></div>}
    {tab === 'review' && <div className="detail-columns"><div><AnalysisPanel incident={incident} reviewer={reviewer} disabled={disabled} onAnalyze={note => action('analyze', note)} />{reviewer && reviewStatuses.includes(incident.status) && <DecisionPanel incident={incident} user={user} disabled={disabled} onAction={(type, note, confirmed, method) => action(type, note, confirmed, undefined, method)} />}{incident.approval && <section className="panel approval-record"><p className="eyebrow">RECORDED RELEASE DECISION</p><h2>Approved by {incident.approval.actor_name}</h2><blockquote>{incident.approval.note}</blockquote><p className="muted">{dateTime(incident.approval.at)} · source version {incident.approval.report_version}</p>{incident.approval.report_version !== sourceVersion(incident) && <p className="notice warning">This decision is for an earlier report version and is not a current release.</p>}</section>}</div><aside><Findings incident={incident} /><Assignment incident={incident} users={users} reviewer={reviewer} disabled={disabled} onAssign={(assignee, note) => action('assign', note, undefined, assignee)} />{reviewer && <Schedule incident={incident} disabled={disabled} onSave={(due_at, note) => perform(() => api.action(id, { action: 'schedule', version: incident.version, due_at, note }), 'Due date and scheduling note recorded by the server.')} />}<Lifecycle incident={incident} user={user} disabled={disabled} onAction={action} /></aside></div>}
    {tab === 'work' && <div className="detail-columns"><div><Execution incident={incident} executable={executable} disabled={disabled} onAction={action} onStep={(item, completed, notes) => perform(() => api.checklist(id, item, { completed, notes, version: incident.version }), 'Work-step record saved by the server.')} /></div><aside><section className="panel provenance-panel"><p className="eyebrow">CONTROLLED HANDOFF</p><h3>Release → Execute → Verify</h3><p>Only the reporter or assigned person can record execution. Required steps need completion notes before a verification handoff.</p><p>An engineer independently reviews the completion record before closing the incident. A worker’s completion is not an engineering verification.</p></section><Lifecycle incident={incident} user={user} disabled={disabled} onAction={action} /></aside></div>}
    {tab === 'history' && <section className="panel timeline-panel"><div className="section-heading"><div><p className="eyebrow">APPEND-ONLY ACTIVITY RECORD</p><h2>Who did what. Against which source.</h2></div></div><p className="muted">Earlier source snapshots and provenance are included in the server’s audit JSON export. Events below are the activity returned for this record.</p>{incident.timeline.length ? <ol className="timeline">{incident.timeline.map(event => <li key={event.id}><span className="timeline-dot" /><div className="timeline-head"><strong>{readable(event.action)}</strong><time dateTime={event.at}>{dateTime(event.at)}</time></div><p className="timeline-person">{event.actor_name} <span>· {event.actor_role} · report v{event.report_version}</span></p>{event.note && <p className="timeline-note">{event.note}</p>}</li>)}</ol> : <Empty title="No events returned."><p>Refresh the record to check its latest activity.</p></Empty>}</section>}
    {tab === 'revise' && (editable ? <ReportEditor key={`${incident.id}:${incident.version}`} user={user} assets={assets} incident={incident} onSaved={value => { update(value); setSuccess('New source version saved. Previous review decisions must be reassessed.'); setTab('source') }} onCancel={() => setTab('source')} onDraftSaved={() => undefined} /> : <div className="notice warning">The report is no longer editable in its current state. Refresh the source record.</div>)}
  </article>
}

function Findings({ incident }: { incident: Incident }) {
  const blocking = incident.findings.filter(f => f.severity === 'blocking').length
  return <section className="panel findings-panel"><div className="section-heading"><div><p className="eyebrow">RULE-DERIVED REVIEW GAPS</p><h3>{blocking ? `${blocking} blocking ${blocking === 1 ? 'gap' : 'gaps'}` : incident.findings.length ? 'Context still worth checking' : 'No rule findings returned'}</h3></div></div>{incident.findings.length ? <ul className="findings">{incident.findings.map((f, i) => <li key={`${f.field}:${i}`} className={f.severity}><span className="finding-severity">{f.severity} · {f.source}</span><strong>{f.label}</strong><p>{f.message}</p></li>)}</ul> : <p className="muted">No rule findings does not establish that the report is safe, correct, or complete. Independent review is still required.</p>}</section>
}

function EvidencePanel({ incident, editable, disabled, onUpload }: { incident: Incident; editable: boolean; disabled: boolean; onUpload: (file: File) => Promise<boolean> }) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const previewEvidence = incident.evidence.find(e => e.id === preview)
  useEffect(() => {
    setPreviewUrl(''); setPreviewError('')
    if (!previewEvidence) return
    let active = true
    let objectUrl = ''
    api.evidenceBlob(previewEvidence.url).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setPreviewUrl(objectUrl) }
    }).catch(e => { if (active) setPreviewError(errorMessage(e)) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [previewEvidence?.id, previewEvidence?.url])
  async function upload(event: FormEvent) {
    event.preventDefault(); setError(''); if (!file) return
    if (file.size > 10 * 1024 * 1024) { setError('Choose a file of 10 MB or less.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) { setError('Choose a JPEG, PNG, WebP image or PDF. The server validates file signatures.'); return }
    if (await onUpload(file)) { setFile(null); if (inputRef.current) inputRef.current.value = '' }
  }
  return <section className="panel evidence-panel">
    <div className="section-heading"><div><p className="eyebrow">SUPPORTING MATERIAL</p><h2>Evidence <span className="count-label">{incident.evidence.length}</span></h2></div><span className="muted small-text">Authenticated access</span></div>
    {incident.evidence.length ? <div className="evidence-grid">
      {incident.evidence.map(e => <article className="evidence-card" key={e.id}>
        <button className={`evidence-thumb ${e.content_type.startsWith('image/') ? '' : 'pdf-thumb'}`} onClick={() => setPreview(preview === e.id ? null : e.id)} aria-label={`Preview ${e.filename}`} aria-expanded={preview === e.id}>
          {e.content_type.startsWith('image/') ? <img src={e.url} alt={`Submitted evidence: ${e.filename}`} loading="lazy" /> : <><span>PDF</span><span>Preview document</span></>}
        </button>
        <div className="evidence-info"><h3>{e.filename}</h3><p>{(e.size / 1024).toFixed(0)} KB · {dateTime(e.created_at)}</p><p>Uploaded by {e.uploaded_by === incident.reporter.id ? incident.reporter.name : e.uploaded_by}</p><a href={e.url} download={e.filename} className="text-button">Download original ↗</a></div>
        {preview === e.id && <div className="evidence-preview">
          {previewError ? <ErrorNotice message={previewError} /> : !previewUrl ? <Loading text="Loading protected evidence…" /> : e.content_type.startsWith('image/') ? <a href={previewUrl} target="_blank" rel="noreferrer"><img src={previewUrl} alt={`Full preview: ${e.filename}`} /></a> : <><iframe src={previewUrl} title={`PDF preview: ${e.filename}`} /><a href={previewUrl} target="_blank" rel="noreferrer">Open PDF preview in a new tab ↗</a></>}
          <button className="text-button" onClick={() => setPreview(null)}>Close preview</button>
        </div>}
      </article>)}
    </div> : <div className="evidence-empty"><Icon name="asset" /><p>No evidence attached. Missing evidence is a review gap, not proof that nothing happened.</p></div>}
    {editable ? <form onSubmit={upload} className="upload-form">
      <label>Attach a safe image or PDF<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => { setFile(e.target.files?.[0] || null); setError('') }} disabled={disabled} /></label>
      <p className="field-help">Maximum 10 MB per file. Evidence changes invalidate stale review. Uploads are online-only and are not stored in device drafts.</p>
      {error && <ErrorNotice message={error} />}<button className="button secondary" disabled={disabled || !file}>Upload selected evidence</button>
    </form> : <p className="field-help evidence-lock">Evidence is read-only in this state or for your account. Only the author can attach evidence before approval.</p>}
  </section>
}

function AnalysisPanel({ incident, reviewer, disabled, onAnalyze }: { incident: Incident; reviewer: boolean; disabled: boolean; onAnalyze: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  const analysis = incident.analysis
  return <section className="panel analysis-panel"><div className="section-heading"><div><p className="eyebrow">ASSISTIVE RULE ANALYSIS</p><h2>Reasoning with the source in view</h2></div>{analysis && <span className="mono version-label">SOURCE v{analysis.report_version}</span>}</div><div className="notice info"><strong>Hypotheses are unverified.</strong><p>This is rule-based assistance, not an automatic diagnosis or a calibrated truth score. Check evidence, contradictions and site conditions independently.</p></div>
    {analysis ? <>{analysis.report_version !== sourceVersion(incident) && <p className="notice warning">Stale analysis. The source is now version {sourceVersion(incident)}. Analyze the current source before approving.</p>}<h3 className="analysis-subtitle">Summary</h3><p className="preserve-lines">{analysis.summary}</p><div className="analysis-group"><h3>Unverified hypotheses</h3>{analysis.hypotheses.length ? <ul>{analysis.hypotheses.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p className="muted">None returned. This does not rule out a fault.</p>}</div><div className="analysis-group"><h3>Suggested review / response actions</h3><ul>{analysis.recommended_actions.map((text, i) => <li key={i}>{text}</li>)}</ul></div><div className="analysis-group"><h3>Safety flags for human review</h3>{analysis.safety_flags.length ? <ul>{analysis.safety_flags.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p className="muted">No flags returned. This is not a safety clearance.</p>}</div><div className="analysis-basis"><span className="eyebrow">BASIS / PROVENANCE</span><p>{analysis.basis}</p></div></> : <Empty title="The source has not been analyzed."><p>Analysis checks the current report for information gaps and suggests unverified hypotheses. It does not release work.</p></Empty>}
    {reviewer && reviewStatuses.includes(incident.status) && <form onSubmit={async e => { e.preventDefault(); if (await onAnalyze(note)) setNote('') }} className="analysis-action"><label>Engineer context for the analysis <span className="optional">optional</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What should the next reviewer know? Recorded with this action." /></label><button className="button primary" disabled={disabled}>{analysis ? 'Analyze current report again' : 'Analyze current report'}<Icon name="arrow" size={18} /></button></form>}
  </section>
}

function DecisionPanel({ incident, user, disabled, onAction }: { incident: Incident; user: User; disabled: boolean; onAction: (action: Action, note?: string, confirmed?: boolean, method?: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [methods, setMethods] = useState<WorkMethod[] | null>(null)
  const [method, setMethod] = useState('')
  const [methodError, setMethodError] = useState('')
  const [methodRevision, setMethodRevision] = useState(0)
  useEffect(() => { let active = true; api.methods().then(value => { if (active) { setMethods(value); setMethodError('') } }).catch(e => { if (active) setMethodError(errorMessage(e)) }); return () => { active = false } }, [methodRevision])
  const selected = methods?.find(value => value.id === method)
  const methodReady = methods !== null && (!methods.length || !!selected)
  const gaps = approvalGaps(incident, user)
  useEffect(() => { setConfirmed(false) }, [incident.version, incident.analysis])
  return <section className="panel decision-panel"><p className="eyebrow">HUMAN REVIEW / INDEPENDENT DECISION</p><h2>Own the release decision.</h2><p className="muted">Read the source and evidence first. Request clarification even when analysis is incomplete. Approval is attributed to {user.name}, not a supplied reviewer name.</p>{gaps.length > 0 && <div className="decision-gaps"><strong>Approval is not available yet</strong><ul>{gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
    {methodError && <ErrorNotice message={methodError}><button className="text-button" onClick={() => setMethodRevision(v => v + 1)}>Retry loading release methods</button></ErrorNotice>}{methods === null && !methodError && <Loading text="Loading site work methods…" />}{methods && (methods.length ? <><label>Work method to copy into this release<select required value={method} onChange={e => { setMethod(e.target.value); setConfirmed(false) }}><option value="">Select a method after reviewing its steps</option>{methods.map(value => <option key={value.id} value={value.id}>{value.name} · v{value.version}</option>)}</select></label>{selected && <div className="notice info"><strong>{selected.name} · v{selected.version}</strong><p>{selected.description}</p><ol>{selected.steps.map((step, i) => <li key={i}>{step.label} ({step.required ? 'required' : 'optional'})</li>)}</ol></div>}</> : <p className="notice warning">No site work methods exist. Approval will create a generic work record, not a site SOP. Follow applicable site procedures; this default is not a verified execution instruction.</p>)}
    <label>Decision / clarification note<textarea rows={4} required value={note} onChange={e => setNote(e.target.value)} placeholder="Explain the decision, outstanding questions, or the basis for releasing the work." /></label><label className="checkbox-label review-confirmation"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={disabled || gaps.length > 0 || !methodReady} />I independently reviewed source version {sourceVersion(incident)}, its evidence, rule findings, and proposed work.</label><div className="decision-actions"><button className="button secondary" disabled={disabled || !note.trim()} onClick={async () => { if (await onAction('request_changes', note.trim())) { setNote(''); setConfirmed(false) } }}>Return for clarification / changes</button><button className="button primary" disabled={disabled || gaps.length > 0 || !methodReady || !confirmed || !note.trim()} onClick={async () => { if (await onAction('approve', note.trim(), confirmed, method || undefined)) { setNote(''); setConfirmed(false) } }}><Icon name="check" size={18} />Approve & release work</button></div><p className="field-help">Approval needs a current analyzed version, no blocking findings, your review confirmation and a decision note. No offline decisions are queued.</p></section>
}

function Assignment({ incident, users, reviewer, disabled, onAssign }: { incident: Incident; users: User[]; reviewer: boolean; disabled: boolean; onAssign: (id: string, note: string) => Promise<boolean> }) {
  const [assignee, setAssignee] = useState(incident.assigned_to?.id || '')
  const [note, setNote] = useState('')
  useEffect(() => { setAssignee(incident.assigned_to?.id || '') }, [incident.assigned_to?.id])
  if (!reviewer || ![...reviewStatuses, 'approved', 'in_progress'].includes(incident.status)) return null
  // Workspace supplies only the current server site's directory.
  const workers = users.filter(u => u.role === 'worker' && u.active !== false)
  return <section className="panel form-panel"><p className="eyebrow">EXECUTION OWNERSHIP</p><h3>Assign the work</h3><form onSubmit={async e => { e.preventDefault(); if (await onAssign(assignee, note)) setNote('') }} className="form-stack"><label>Responsible worker<select required value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Choose a person</option>{workers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>Assignment context <span className="optional">optional</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>{workers.length === 0 && <p className="field-help">No worker accounts returned. Ask the administrator to create the execution team.</p>}<button className="button secondary" disabled={disabled || !assignee}>Save assignment</button></form></section>
}

function Execution({ incident, executable, disabled, onAction, onStep }: { incident: Incident; executable: boolean; disabled: boolean; onAction: (action: Action, note?: string) => Promise<boolean>; onStep: (id: string, completed: boolean, notes: string) => Promise<boolean> }) {
  const [handoffNote, setHandoffNote] = useState('')
  const released = ['approved', 'in_progress'].includes(incident.status)
  const missing = incident.checklist.filter(step => step.required && (!step.completed || !step.notes.trim())).length
  return <section className="panel execution-panel"><div className="section-heading"><div><p className="eyebrow">RELEASED WORK RECORD</p><h2>Execution checklist</h2></div><span className="mono">{incident.checklist.filter(s => s.completed).length} / {incident.checklist.length}</span></div>
    {!incident.approval && <div className="notice warning">There is no recorded release decision. Do not treat analysis suggestions as approved work.</div>}
    {!executable && <p className="notice info">Read-only execution record. Only the reporter or assigned worker can save step completion.</p>}
    {incident.status === 'approved' && executable && <div className="start-work"><p>The current work is released. Record progress only against the approved checklist and your site procedures.</p><button className="button primary" disabled={disabled} onClick={() => onAction('start', 'Started the released work checklist.')}>Begin released work<Icon name="arrow" size={18} /></button></div>}
    {incident.checklist.length ? <ol className="work-checklist">{incident.checklist.map((item, index) => <ChecklistStep key={item.id} item={item} index={index} editable={released && executable} disabled={disabled} onSave={(completed, notes) => onStep(item.id, completed, notes)} />)}</ol> : <Empty title="No released checklist is available."><p>Work steps appear after the report has been reviewed and approved. Analysis suggestions are not an execution release.</p></Empty>}
    {released && executable && <form className="handoff-form" onSubmit={async e => { e.preventDefault(); if (await onAction('submit_verification', handoffNote.trim())) setHandoffNote('') }}><p className="eyebrow">WORKER → ENGINEER</p><h3>Hand off for independent verification</h3><label>Completion & handoff note<textarea required rows={3} value={handoffNote} onChange={e => setHandoffNote(e.target.value)} placeholder="Describe the work completed, observations after execution, and remaining concerns." /></label>{missing > 0 && <p className="field-help">{missing} required {missing === 1 ? 'step needs' : 'steps need'} completion and notes before handoff.</p>}<button className="button primary" disabled={disabled || incident.status !== 'in_progress' || missing > 0 || incident.checklist.length === 0 || !handoffNote.trim()}>Submit for engineer verification<Icon name="arrow" size={18} /></button></form>}
    {incident.status === 'awaiting_verification' && <p className="notice info"><strong>Handoff recorded.</strong> Work is awaiting independent engineering verification. It is not closed yet.</p>}
  </section>
}

function ChecklistStep({ item, index, editable, disabled, onSave }: { item: ChecklistItem; index: number; editable: boolean; disabled: boolean; onSave: (completed: boolean, notes: string) => Promise<boolean> }) {
  const [completed, setCompleted] = useState(item.completed)
  const [notes, setNotes] = useState(item.notes || '')
  useEffect(() => { setCompleted(item.completed); setNotes(item.notes || '') }, [item.completed, item.notes])
  const changed = completed !== item.completed || notes !== (item.notes || '')
  useUnsavedChanges(editable && changed)
  return <li className={item.completed ? 'step-complete' : ''}><div className="checklist-step-head"><span className="step-number">{item.completed ? <Icon name="check" size={18} /> : String(index + 1).padStart(2, '0')}</span><div><h3>{item.label}</h3><span className="field-help">{item.required ? 'Required step' : 'Optional step'} · {item.completed ? 'Completion saved' : 'Not yet completed'}</span></div></div>{editable ? <form onSubmit={e => { e.preventDefault(); void onSave(completed, notes.trim()) }}><label>Execution notes<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Record what you did and what you observed. Required for required-step completion." /></label><div className="checklist-save"><label className="checkbox-label"><input type="checkbox" checked={completed} onChange={e => setCompleted(e.target.checked)} disabled={disabled} />Mark complete on save</label><button className="button secondary small" disabled={disabled || !changed || (completed && item.required && !notes.trim())}>Save step record</button></div>{changed && <p className="field-help">Unsaved step changes. Save before moving to another section.</p>}</form> : <p className="step-notes">{item.notes || 'No execution notes recorded.'}</p>}</li>
}

function Lifecycle({ incident, user, disabled, onAction }: { incident: Incident; user: User; disabled: boolean; onAction: (action: Action, note?: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  const reviewer = isReviewer(user)
  const independent = incident.reporter.id !== user.id && incident.assigned_to?.id !== user.id
  const verify = reviewer && independent && incident.status === 'awaiting_verification'
  const reopen = reviewer && incident.status === 'resolved'
  const cancel = (reviewer || incident.reporter.id === user.id) && reviewStatuses.includes(incident.status)
  if (reviewer && !independent && incident.status === 'awaiting_verification') return <section className="panel lifecycle-panel"><p className="eyebrow">INDEPENDENT VERIFICATION REQUIRED</p><h3>Another engineer must verify.</h3><p className="muted">The report author and assigned executor cannot independently close this work. Ask another engineer or supervisor to review the handoff.</p></section>
  if (!verify && !reopen && !cancel) return null
  return <section className="panel lifecycle-panel"><p className="eyebrow">{verify ? 'INDEPENDENT VERIFICATION' : reopen ? 'FOLLOW-UP CONTROL' : 'RECORD CONTROL'}</p><h3>{verify ? 'Verify the execution record' : reopen ? 'Reopen with context' : 'Cancel this report'}</h3><p className="muted">{verify ? 'Read each saved step and its notes, assess the handoff and site condition, then record your verification decision.' : reopen ? 'New evidence or recurrence can reopen the incident. Explain the reason in the audit trail.' : 'Cancellation retains the source and audit history. A reason is required here.'}</p><label>{verify ? 'Verification / return note' : 'Reason'}<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></label><div className="form-stack">{verify && <><button className="button primary" disabled={disabled || !note.trim()} onClick={() => onAction('resolve', note.trim())}><Icon name="check" size={18} />Verify & close incident</button><button className="button secondary" disabled={disabled || !note.trim()} onClick={() => onAction('request_changes', note.trim())}>Return with verification concerns</button></>}{reopen && <button className="button secondary" disabled={disabled || !note.trim()} onClick={() => onAction('reopen', note.trim())}>Reopen incident</button>}{cancel && <button className="button danger" disabled={disabled || !note.trim()} onClick={() => onAction('cancel', note.trim())}>Cancel with reason</button>}</div></section>
}

function Schedule({ incident, disabled, onSave }: { incident: Incident; disabled: boolean; onSave: (due: string, note: string) => Promise<boolean> }) {
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  return <section className="panel form-panel"><p className="eyebrow">SCHEDULE / ACCOUNTABLE DEADLINE</p><h3>Set due date</h3><p className="field-help">Current due: {dateTime(incident.due_at)}. Enter local time; it will be sent with its UTC timezone.</p><form className="form-stack" onSubmit={async e => { e.preventDefault(); const date = new Date(due); if (!Number.isFinite(date.getTime())) { setError('Choose a valid date and time.'); return } setError(''); if (await onSave(date.toISOString(), note.trim())) setNote('') }}><label>Due at (your local time)<input type="datetime-local" required value={due} onChange={e => setDue(e.target.value)} /></label><label>Scheduling reason / handoff note<textarea required value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>{error && <ErrorNotice message={error} />}<button className="button secondary" disabled={disabled || !due || !note.trim()}>Record due date & note</button></form></section>
}
