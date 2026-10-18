import type { Action, AdminAudit, Asset, Incident, IncidentPage, Integration, Metrics, Notification, Observation, ReportInput, Role, Session, Site, User, WorkMethod } from './types'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError' }
}
export class NetworkError extends Error {
  constructor(message = 'The server could not be reached. Check your connection and try again.') { super(message); this.name = 'NetworkError' }
}
async function responseFor(url: string, options: RequestInit = {}): Promise<Response> {
  let response: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    response = await fetch(url, { ...options, signal: options.signal ?? controller.signal, credentials: 'same-origin', headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers } })
  } catch {
    throw new NetworkError(controller.signal.aborted ? 'No server confirmation within 20 seconds. The request may have arrived; refresh the record before repeating a decision, or retain the same draft client ID.' : undefined)
  } finally { clearTimeout(timer) }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { loc?: string[]; msg?: string }) => `${d.loc?.filter(x => x !== 'body').join('.') || 'Input'}: ${d.msg || 'invalid value'}`).join('; ')
      else if (typeof body.detail?.message === 'string') message = body.detail.message
      else if (typeof body.message === 'string') message = body.message
    } catch { /* Keep the HTTP status if a proxy returned a non-JSON error. */ }
    throw new ApiError(message, response.status)
  }
  return response
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await responseFor(`/api/v1${path}`, options)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const api = {
  setupStatus: () => request<{ needs_setup: boolean }>('/setup/status'),
  setup: (data: { organization_name: string; site_name: string; name: string; email: string; password: string }) => post<{ user: User }>('/setup', data),
  login: (email: string, password: string, otp?: string, recovery_code?: string) => post<{ user: User }>('/auth/login', { email, password, otp, recovery_code }),
  resetPassword: (token: string, new_password: string) => post<void>('/auth/reset-password', { token, new_password }),
  changePassword: (current_password: string, new_password: string, otp?: string) => post<void>('/auth/change-password', { current_password, new_password, otp }),
  sessions: () => request<Session[]>('/auth/sessions'),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeOthers: () => post<void>('/auth/sessions/revoke-others', {}),
  enrollMfa: (password: string) => post<{ secret: string; otpauth_uri: string }>('/auth/mfa/enroll', { password }),
  confirmMfa: (otp: string) => post<{ recovery_codes: string[] }>('/auth/mfa/confirm', { otp }),
  disableMfa: (password: string, otp: string) => post<void>('/auth/mfa/disable', { password, otp }),
  me: () => request<{ user: User }>('/auth/me'),
  logout: () => post<void>('/auth/logout', {}),
  assets: () => request<Asset[]>('/assets'),
  createAsset: (data: Omit<Asset, 'id' | 'status'>) => post<Asset>('/assets', data),
  users: () => request<User[]>('/users'),
  createUser: (data: { name: string; email: string; password: string; role: Role }) => post<User>('/users', data),
  updateUser: (id: string, data: { active?: boolean; role?: Role }) => request<User>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  recoverUser: (id: string) => post<{ token: string; expires_at: string }>(`/users/${encodeURIComponent(id)}/recovery`, {}),
  sites: () => request<Site[]>('/sites'),
  createSite: (name: string) => post<Site>('/sites', { name }),
  switchSite: (site_id: string) => post<{ user: User }>('/auth/switch-site', { site_id }),
  audit: (offset = 0) => request<AdminAudit>(`/admin/audit?limit=25&offset=${offset}`),
  methods: () => request<WorkMethod[]>('/work-methods'),
  createMethod: (data: Omit<WorkMethod, 'id' | 'version'>) => post<WorkMethod>('/work-methods', data),
  notifications: () => request<Notification[]>('/notifications'),
  readNotification: (id: string) => post<void>(`/notifications/${encodeURIComponent(id)}/read`, {}),
  metrics: () => request<Metrics>('/metrics/summary'),
  integrations: () => request<Integration[]>('/integrations'),
  createIntegration: (name: string) => post<{ id: string; name: string; token: string }>('/integrations', { name }),
  revokeIntegration: (id: string) => request<void>(`/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  observations: (id: string) => request<Observation[]>(`/assets/${encodeURIComponent(id)}/observations`),
  incidents: () => request<Incident[]>('/incidents'),
  incidentPage: (query: { limit: number; offset: number; search: string; status: string; mine: boolean }) => request<IncidentPage>(`/incidents/page?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`),
  incident: (id: string) => request<Incident>(`/incidents/${encodeURIComponent(id)}`),
  createIncident: (data: ReportInput) => post<Incident>('/incidents', data),
  reviseIncident: (id: string, data: Omit<ReportInput, 'client_id'> & { version: number }) => request<Incident>(`/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  action: (id: string, data: { action: Action; version: number; note?: string; review_confirmed?: boolean; assigned_to?: string; work_method_id?: string; due_at?: string }) => post<Incident>(`/incidents/${encodeURIComponent(id)}/actions`, data),
  checklist: (id: string, item: string, data: { completed: boolean; notes: string; version: number }) => request<Incident>(`/incidents/${encodeURIComponent(id)}/checklist/${encodeURIComponent(item)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  upload: (id: string, file: File, version: number) => { const body = new FormData(); body.append('file', file); body.append('version', String(version)); return request<Incident>(`/incidents/${encodeURIComponent(id)}/evidence`, { method: 'POST', body }) },
  evidenceBlob: async (url: string) => {
    const target = new URL(url, window.location.origin)
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/v1/')) throw new Error('The evidence URL is not a protected site API resource.')
    return (await responseFor(target.href)).blob()
  },
  export: (id: string) => request<unknown>(`/incidents/${encodeURIComponent(id)}/export`),
}
