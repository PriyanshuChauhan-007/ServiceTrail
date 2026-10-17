import type { Analysis, BridgeStatus, Checklist, HistoryEntry, ParsedEvent, Scenario, SyncSummary } from './types'

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

const optionalRequest = async <T>(paths: string[], init?: RequestInit): Promise<T> => {
  let lastError: unknown
  for (const path of paths) {
    try {
      return await request<T>(path, init)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Optional endpoint unavailable')
}

const normalizeHistory = (value: unknown): HistoryEntry[] => {
  const payload = value && typeof value === 'object' ? value as { items?: unknown[]; records?: unknown[]; history?: unknown[] } : {}
  const records = Array.isArray(value) ? value : (payload.items ?? payload.records ?? payload.history ?? [])
  return records.flatMap(record => {
    if (!record || typeof record !== 'object') return []
    const item = record as Record<string, unknown>
    const parsed = item.parsed && typeof item.parsed === 'object' ? item.parsed as Record<string, unknown> : item
    const bridgeId = String(item.bridge_id ?? parsed.bridge_id ?? '')
    if (!bridgeId) return []
    const statusRecord = item.status && typeof item.status === 'object' ? item.status as Record<string, unknown> : undefined
    const analysisRecord = item.analysis && typeof item.analysis === 'object' ? item.analysis as Record<string, unknown> : undefined
    return [{
      bridge_id: bridgeId,
      scenario_id: String(item.scenario_id ?? parsed.scenario_id ?? 'cnc_press_breakdown'),
      source_text: String(item.source_text ?? parsed.source_text ?? ''),
      status: String(statusRecord?.status ?? item.status ?? 'received'),
      severity: (item.severity ?? parsed.severity ?? 'medium') as HistoryEntry['severity'],
      asset_id: (item.asset_id ?? parsed.asset_id ?? null) as string | null,
      location: (item.location ?? parsed.location ?? null) as string | null,
      created_at: String(item.created_at ?? parsed.updated_at ?? new Date().toISOString()),
      updated_at: item.updated_at ? String(item.updated_at) : undefined,
      analysis_summary: String(item.analysis_summary ?? analysisRecord?.summary ?? '') || undefined,
    }]
  })
}

export const api = {
  scenarios: () => request<Scenario[]>('/api/scenarios'),
  parse: (text: string, scenarioId?: string) => request<ParsedEvent>('/api/bridge/parse', { method: 'POST', body: JSON.stringify({ text, scenario_id: scenarioId }) }),
  analyze: (parsed: ParsedEvent) => request<Analysis>('/api/bridge/analyze', { method: 'POST', body: JSON.stringify({ parsed }) }),
  approve: (analysisId: string, decision: 'approved' | 'rejected' | 'needs_changes', note?: string) => request<{ status: string }>('/api/bridge/approve', { method: 'POST', body: JSON.stringify({ analysis_id: analysisId, decision, approver: 'Priyanshu', note: note ?? (decision === 'approved' ? 'Approved for controlled execution.' : 'Review required before execution.') }) }),
  checklist: (analysisId: string) => request<Checklist>('/api/bridge/checklist', { method: 'POST', body: JSON.stringify({ analysis_id: analysisId }) }),
  updateChecklistItem: (bridgeId: string, itemId: string, completed: boolean, notes?: string | null) => request<Checklist>(`/api/bridge/checklist/${encodeURIComponent(bridgeId)}`, { method: 'PATCH', body: JSON.stringify({ item_id: itemId, completed, notes: notes ?? null }) }),
  status: (bridgeId: string, status: BridgeStatus) => request('/api/bridge/status', { method: 'PATCH', body: JSON.stringify({ bridge_id: bridgeId, status, updated_by: 'Priyanshu' }) }),
  history: async () => normalizeHistory(await optionalRequest<unknown>(['/api/bridge/history', '/api/history'])),
  mutations: () => request<SyncSummary & { mutations?: unknown[] }>('/api/sync/mutations?pending_only=true&limit=100'),
  health: () => request<{ status: string }>('/health'),
}
