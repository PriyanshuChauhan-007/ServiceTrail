import type { Analysis, BridgeStatus, Checklist, ParsedEvent, Scenario } from './types'

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export const api = {
  scenarios: () => request<Scenario[]>('/api/scenarios'),
  parse: (text: string, scenarioId?: string) => request<ParsedEvent>('/api/bridge/parse', { method: 'POST', body: JSON.stringify({ text, scenario_id: scenarioId }) }),
  analyze: (parsed: ParsedEvent) => request<Analysis>('/api/bridge/analyze', { method: 'POST', body: JSON.stringify({ parsed }) }),
  approve: (analysisId: string, decision: 'approved' | 'rejected' | 'needs_changes') => request<{ status: string }>('/api/bridge/approve', { method: 'POST', body: JSON.stringify({ analysis_id: analysisId, decision, approver: 'Control Room Lead', note: decision === 'approved' ? 'Approved for controlled execution.' : 'Review required before execution.' }) }),
  checklist: (analysisId: string) => request<Checklist>('/api/bridge/checklist', { method: 'POST', body: JSON.stringify({ analysis_id: analysisId }) }),
  status: (bridgeId: string, status: BridgeStatus) => request('/api/bridge/status', { method: 'PATCH', body: JSON.stringify({ bridge_id: bridgeId, status, updated_by: 'OpsBridge Console' }) }),
}
