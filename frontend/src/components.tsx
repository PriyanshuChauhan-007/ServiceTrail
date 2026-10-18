import { useEffect, type ReactNode } from 'react'
import type { IncidentStatus } from './types'
import { statusLabels } from './logic'

export function Icon({ name, size = 20 }: { name: 'grid' | 'book' | 'asset' | 'people' | 'arrow' | 'plus' | 'sun' | 'moon' | 'check' | 'search' | 'download' | 'logout'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h7m-7 4h7m-7 3h4" /></>,
    book: <><path d="M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 14h14M7 7h8m-8 4h5" /></>,
    asset: <><path d="M3 9 12 4l9 5v11H3V9Zm0 0 9 5 9-5M12 14v6" /><path d="m7 6 9 5" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    logout: <path d="M9 4H4v16h5m5-15 7 7-7 7m-5-7h12" />,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
export function Brand({ compact = false }: { compact?: boolean }) { return <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>opsbridge<span className="brand-dot">.</span>{!compact && <small>MANUFACTURING OPERATIONS</small>}</span></div> }
export function Badge({ status }: { status: IncidentStatus }) { return <span className={`badge status-${status}`}><span aria-hidden="true" />{statusLabels[status]}</span> }
export function ErrorNotice({ message, children }: { message: string; children?: ReactNode }) { return <div className="notice error" role="alert"><strong>Action not completed</strong><p>{message}</p>{children}</div> }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><span className="empty-mark" aria-hidden="true">↗</span><h3>{title}</h3><div>{children}</div></div> }
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) { return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="lede">{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</header> }
export function Loading({ text = 'Loading workspace…' }: { text?: string }) { return <div className="loading" role="status"><span className="spinner" />{text}</div> }

// Preserve unsaved field observations/step notes on SPA navigation, not only reload.
export function confirmNavigation(): boolean {
  return window.dispatchEvent(new CustomEvent('opsbridge:before-navigation', { cancelable: true, detail: { accepted: false } }))
}

export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const navigate = (event: Event) => {
      const prompt = event as CustomEvent<{ accepted: boolean }>
      if (prompt.defaultPrevented || prompt.detail.accepted) return
      if (window.confirm('Some observations or work-step notes have not been saved. Leave without saving these changes?')) prompt.detail.accepted = true
      else prompt.preventDefault()
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('opsbridge:before-navigation', navigate)
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('opsbridge:before-navigation', navigate) }
  }, [dirty])
}
