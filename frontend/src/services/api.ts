import type { ApiEnvelope, ChecklistItem, ContractEvent, OpsSnapshot } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

const offlineSnapshot: OpsSnapshot = {
  plant: 'North Valley Processing · Unit 04',
  lastSync: '14:32:08 UTC',
  metrics: [
    { label: 'Overall equipment effectiveness', value: '91.8%', detail: '+2.4% vs shift target', health: 'normal' },
    { label: 'Throughput', value: '1,284', detail: 'units / hour · 98.7% plan', health: 'normal' },
    { label: 'Energy intensity', value: '18.6', detail: 'kWh / unit · 0.8 above baseline', health: 'watch' },
    { label: 'Active alarms', value: '03', detail: '1 critical · 2 advisory', health: 'alarm' },
  ],
  temperature: [
    { time: '08:00', temperature: 67, threshold: 82 }, { time: '09:00', temperature: 69, threshold: 82 },
    { time: '10:00', temperature: 71, threshold: 82 }, { time: '11:00', temperature: 73, threshold: 82 },
    { time: '12:00', temperature: 76, threshold: 82 }, { time: '13:00', temperature: 79, threshold: 82 },
    { time: '14:00', temperature: 84, threshold: 82 }, { time: '15:00', temperature: 81, threshold: 82 },
  ],
  incidents: [
    { id: 'INC-2408', asset: 'Furnace 04', title: 'Discharge temperature above alarm threshold', severity: 'P1', status: 'Open', owner: 'Unassigned', updated: '2 min ago' },
    { id: 'INC-2407', asset: 'Compressor C2', title: 'Vibration trend requires inspection', severity: 'P2', status: 'Acknowledged', owner: 'M. Chen', updated: '18 min ago' },
    { id: 'INC-2404', asset: 'Line 2', title: 'Material feed variance', severity: 'P3', status: 'Open', owner: 'S. Patel', updated: '41 min ago' },
  ],
  checklist: [
    { id: 'CHK-01', label: 'Verify Furnace 04 cooling loop', detail: 'Compare inlet/outlet delta and confirm pump status.', done: false, owner: 'Shift lead' },
    { id: 'CHK-02', label: 'Review compressor C2 vibration sample', detail: 'Capture a 60-second sample before handoff.', done: false, owner: 'Maintenance' },
    { id: 'CHK-03', label: 'Confirm Line 2 material calibration', detail: 'Calibration certificate attached to work order.', done: true, owner: 'Quality' },
    { id: 'CHK-04', label: 'Publish shift handoff notes', detail: 'Include open alarms and temporary controls.', done: false, owner: 'Control room' },
  ],
  reportTemplate: 'At 14:00 UTC, Furnace 04 discharge temperature reached 84°C, exceeding the 82°C alarm threshold. Cooling loop verification is in progress. No throughput impact observed.',
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
let localState = clone(offlineSnapshot)

export async function fetchClient<T>(path: string, options?: RequestInit, fallback?: T): Promise<ApiEnvelope<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return { data: (await response.json()) as T, source: 'api', timestamp: new Date().toISOString() }
  } catch {
    if (fallback === undefined) throw new Error('Offline and no fallback supplied')
    return { data: clone(fallback), source: 'offline', timestamp: new Date().toISOString() }
  }
}

export async function getSnapshot() { return fetchClient<OpsSnapshot>('/snapshot', undefined, localState) }

export async function sendEvent(event: ContractEvent) {
  const response = await fetchClient<{ ok: boolean }>('/events', { method: 'POST', body: JSON.stringify(event) }, { ok: true })
  if (event.action === 'acknowledge' || event.action === 'resolve') {
    const incident = localState.incidents.find((item) => item.id === event.incidentId)
    if (incident) incident.status = event.action === 'resolve' ? 'Resolved' : 'Acknowledged'
  }
  if (event.action === 'checklist-update') {
    const item = localState.checklist.find((entry) => entry.id === event.itemId)
    if (item) item.done = event.done
  }
  return response
}

export async function updateChecklist(items: ChecklistItem[]) {
  localState.checklist = clone(items)
  return fetchClient<ChecklistItem[]>('/checklist', { method: 'PUT', body: JSON.stringify(items) }, items)
}

export { offlineSnapshot }
