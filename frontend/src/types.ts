export type TabId = 'dashboard' | 'report' | 'control' | 'checklist'

export type Health = 'normal' | 'watch' | 'alarm'

export interface TemperaturePoint {
  time: string
  temperature: number
  threshold: number
}

export interface PlantMetric {
  label: string
  value: string
  detail: string
  health: Health
}

export interface Incident {
  id: string
  asset: string
  title: string
  severity: 'P1' | 'P2' | 'P3'
  status: 'Open' | 'Acknowledged' | 'Resolved'
  owner: string
  updated: string
}

export interface ChecklistItem {
  id: string
  label: string
  detail: string
  done: boolean
  owner: string
}

export interface OpsSnapshot {
  plant: string
  lastSync: string
  metrics: PlantMetric[]
  temperature: TemperaturePoint[]
  incidents: Incident[]
  checklist: ChecklistItem[]
  reportTemplate: string
}

export interface ApiEnvelope<T> {
  data: T
  source: 'api' | 'offline'
  timestamp: string
}

export type ContractEvent =
  | { action: 'acknowledge'; incidentId: string }
  | { action: 'resolve'; incidentId: string }
  | { action: 'submit-report'; report: string }
  | { action: 'control-action'; command: string }
  | { action: 'checklist-update'; itemId: string; done: boolean }
