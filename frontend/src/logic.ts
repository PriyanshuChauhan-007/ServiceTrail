import type { Incident, IncidentStatus, User } from './types'

export const statusLabels: Record<IncidentStatus, string> = {
  submitted: 'Submitted', needs_clarification: 'Clarification needed', ready_for_review: 'Ready for review', under_review: 'Under review', changes_requested: 'Changes requested', approved: 'Released for work', in_progress: 'Work in progress', awaiting_verification: 'Awaiting verification', resolved: 'Closed', reopened: 'Reopened', cancelled: 'Cancelled',
}
export const editableStatuses: IncidentStatus[] = ['submitted', 'needs_clarification', 'changes_requested']
export const reviewStatuses: IncidentStatus[] = ['submitted', 'needs_clarification', 'ready_for_review', 'under_review', 'changes_requested', 'reopened']
export const isReviewer = (user: User) => ['engineer', 'supervisor', 'admin'].includes(user.role)
export const canEdit = (incident: Incident, user: User) => incident.reporter.id === user.id && editableStatuses.includes(incident.status)
export const canExecute = (incident: Incident, user: User) => incident.reporter.id === user.id || incident.assigned_to?.id === user.id
// Record revision is the optimistic-lock token; source version comes from the
// append-only audit. A decision/assignment can advance the former, not the latter.
export const sourceVersion = (incident: Incident) => incident.timeline.length ? Math.max(...incident.timeline.map(event => event.report_version)) : incident.version
export const approvalGaps = (incident: Incident, user: User): string[] => [
  ...(incident.reporter.id === user.id ? ['An independent reviewer must approve this report.'] : []),
  ...(incident.assigned_to?.id === user.id ? ['The assigned executor cannot independently approve this report.'] : []),
  ...(!incident.analysis ? ['Analyze the current report before approval.'] : incident.analysis.report_version !== sourceVersion(incident) ? ['Analysis is from an earlier report version. Analyze again.'] : []),
  ...(!['ready_for_review', 'under_review'].includes(incident.status) ? ['The report must be ready for review before approval.'] : []),
  ...incident.findings.filter(f => f.severity === 'blocking').map(f => f.message),
]
export const nextStep = (incident: Incident): string => {
  switch (incident.status) {
    case 'submitted': return 'Engineer · analyze the report'
    case 'needs_clarification': case 'changes_requested': return 'Reporter · revise the source report'
    case 'ready_for_review': case 'under_review': return 'Independent engineer · review and decide'
    case 'approved': return 'Worker · begin the released checklist'
    case 'in_progress': return 'Worker · complete steps and hand off'
    case 'awaiting_verification': return 'Engineer · verify execution and close'
    case 'reopened': return 'Engineer · reassess the reopened report'
    case 'resolved': return 'Closed · audit record available'
    case 'cancelled': return 'Cancelled · audit record retained'
  }
}
export function filterIncidents(items: Incident[], search: string, status: string, mine: boolean, userId: string): Incident[] {
  const query = search.trim().toLocaleLowerCase()
  const groups: Record<string, string[]> = { open: Object.keys(statusLabels).filter(s => !['resolved', 'cancelled'].includes(s)), review_attention: ['submitted', 'ready_for_review', 'under_review', 'reopened'], clarification: ['needs_clarification', 'changes_requested'], released: ['approved', 'in_progress'] }
  return items.filter(i => (status === 'all' || (groups[status] ? groups[status].includes(i.status) : i.status === status)) && (!mine || i.reporter.id === userId || i.assigned_to?.id === userId) && (!query || [i.number, i.asset?.code, i.asset?.name, i.asset?.area, i.description, i.reporter.name].filter(Boolean).join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
}
export const readable = (value: string) => value.replaceAll('_', ' ')
export const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not set'
export const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
