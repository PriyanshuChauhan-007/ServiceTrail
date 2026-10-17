export type Category = 'industrial' | 'civic' | 'logistics'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type BridgeStatus = 'received' | 'parsed' | 'analyzed' | 'pending_approval' | 'approved' | 'in_progress' | 'resolved' | 'blocked'

export type Scenario = {
  id: string
  name: string
  category: Category
  description: string
  criticality: Priority
  tags: string[]
  sample_reports: string[]
}

export type ParsedEvent = {
  bridge_id: string
  scenario_id: string
  source_text: string
  event_type: string
  asset_id: string | null
  machine: string | null
  location: string | null
  symptoms: string[]
  severity: Priority
  safety_flags: string[]
  downtime_minutes: number | null
  quantities: Record<string, number>
  extracted_keywords: string[]
  confidence: number
}

export type Analysis = {
  analysis_id: string
  bridge_id: string
  scenario_id: string
  priority: Priority
  summary: string
  root_cause_hypotheses: string[]
  recommended_actions: string[]
  safety_flags: string[]
  approval_required: boolean
  approval_reasons: string[]
  confidence: number
  status: BridgeStatus
}

export type ChecklistItem = { id: string; label: string; owner: string; required: boolean; completed: boolean; notes: string | null }
export type Checklist = { bridge_id: string; scenario_id: string; items: ChecklistItem[] }
