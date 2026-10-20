export type Role = 'worker' | 'engineer' | 'supervisor' | 'admin'
export interface User { id: string; name: string; email: string; role: Role; organization_id: string; site_id: string; organization_name: string; site_name: string; active?: boolean; must_change_password?: boolean; mfa_enabled?: boolean }
export interface Asset { id: string; code: string; name: string; area: string; criticality: 'low' | 'medium' | 'high' | 'critical'; manufacturer?: string; model?: string; status: string }
export type IncidentStatus = 'submitted' | 'needs_clarification' | 'ready_for_review' | 'under_review' | 'changes_requested' | 'approved' | 'in_progress' | 'awaiting_verification' | 'resolved' | 'reopened' | 'cancelled'
export interface ReportInput { asset_id: string; description: string; impact: string; injury_status: 'none' | 'reported' | 'unknown'; safe_state: 'isolated' | 'stopped' | 'running' | 'unknown'; measurements: string; client_id?: string }
export interface Finding { field: string; label: string; message: string; severity: 'blocking' | 'warning'; source: 'rule' }
export interface Analysis { summary: string; hypotheses: string[]; recommended_actions: string[]; safety_flags: string[]; basis: string; report_version: number }
export interface Evidence { id: string; filename: string; content_type: string; size: number; uploaded_by: string; created_at: string; url: string }
export interface ChecklistItem { id: string; label: string; required: boolean; completed: boolean; notes: string }
export interface TimelineEvent { id: string; action: string; actor_name: string; actor_role: string; note: string; at: string; report_version: number }
export interface Incident { id: string; number: string; asset_id: string; asset: Asset; description: string; impact: string; injury_status: ReportInput['injury_status']; safe_state: ReportInput['safe_state']; measurements: string; priority: string; status: IncidentStatus; version: number; reporter: { id: string; name: string }; assigned_to: { id: string; name: string } | null; created_at: string; updated_at: string; due_at: string | null; findings: Finding[]; analysis: Analysis | null; approval: { actor_name: string; note: string; at: string; report_version: number } | null; checklist: ChecklistItem[]; evidence: Evidence[]; timeline: TimelineEvent[] }
export type Action = 'analyze' | 'request_changes' | 'approve' | 'start' | 'submit_verification' | 'resolve' | 'reopen' | 'cancel' | 'assign' | 'schedule'
export interface IncidentPage { items: Incident[]; total: number; counts: Record<string, number> }
export interface WorkMethod { id: string; name: string; description: string; steps: { label: string; required: boolean }[]; version: number }
export interface Session { id: string; created_at: string; expires_at: string; current: boolean }
export interface Site { id: string; name: string }
export interface Notification { id: string; title: string; message: string; incident_id?: string; created_at: string; read_at: string | null }
export interface Integration { id: string; name: string; created_at?: string; revoked_at?: string | null; active?: boolean }
export interface Observation { id: string; external_id: string; observed_at: string; measurements: Record<string, unknown>; integration_id?: string; integration_name?: string; created_at?: string }
export interface Metrics { counts: Record<string, number>; total?: number; overdue: number; median_resolution_minutes: number | null }
export interface Dashboard {
  total: number
  counts: Record<string, number>
  overdue: number
  priority_counts: Record<string, number>
  resolution: { count: number; median_minutes: number | null; avg_minutes: number | null }
  asset_frequency: { code: string; name: string; area: string; total_count: number }[]
  recent_resolved: { number: string; created_at: string; resolved_at: string; duration_minutes: number }[]
}
export interface AdminAudit { items: { id: string; action: string; actor_name: string; note: string; at: string }[]; total: number }
