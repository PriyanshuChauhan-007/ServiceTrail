import { useEffect, useState } from 'react'
import { api } from './api'
import { Empty, ErrorNotice, Loading, PageHeading } from './components'
import { dateTime, errorMessage, readable, shortDate } from './logic'
import type { Dashboard } from './types'

const STATUS_ORDER = [
  'submitted', 'needs_clarification', 'changes_requested', 'ready_for_review',
  'under_review', 'approved', 'in_progress', 'awaiting_verification',
  'resolved', 'reopened', 'cancelled',
]
const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', needs_clarification: 'Clarification needed',
  changes_requested: 'Changes requested', ready_for_review: 'Ready for review',
  under_review: 'Under review', approved: 'Released', in_progress: 'In progress',
  awaiting_verification: 'Awaiting verification', resolved: 'Closed',
  reopened: 'Reopened', cancelled: 'Cancelled',
}
const OPEN_STATUSES = new Set([
  'submitted', 'needs_clarification', 'changes_requested',
  'ready_for_review', 'under_review', 'approved', 'in_progress',
  'awaiting_verification', 'reopened',
])

function fmt(n: number | null | undefined, unit = '') {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + (unit ? ' ' + unit : '')
}

export default function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true); setError('')
    try { setData(await api.dashboard()) }
    catch (e) { setError(errorMessage(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const openCount = data ? Object.entries(data.counts).filter(([s]) => OPEN_STATUSES.has(s)).reduce((a, [, v]) => a + v, 0) : 0

  return <>
    <PageHeading
      eyebrow="ANALYTICS / LIVE SITE AGGREGATES"
      title="Operations at a glance."
      description="Counts from persisted server records. No estimated readings, no invented scores."
      action={<button className="button secondary" onClick={refresh} disabled={loading}>Refresh data</button>}
    />
    {error && <ErrorNotice message={error} />}
    {loading && !data && <Loading text="Loading site analytics…" />}
    {data && <>
      {/* Summary strip */}
      <div className="dashboard-strip">
        <div className="dash-stat">
          <span>Total reports</span>
          <strong>{data.total}</strong>
          <small>{openCount} open</small>
        </div>
        <div className="dash-stat dash-stat-accent">
          <span>Overdue</span>
          <strong>{data.overdue}</strong>
          <small>past scheduled due date</small>
        </div>
        <div className="dash-stat">
          <span>Resolved</span>
          <strong>{data.resolution.count}</strong>
          <small>total closed reports</small>
        </div>
        <div className="dash-stat">
          <span>Median resolution</span>
          <strong>{data.resolution.median_minutes != null ? fmt(data.resolution.median_minutes / 60, 'hr') : '—'}</strong>
          <small>{data.resolution.avg_minutes != null ? `avg ${fmt(data.resolution.avg_minutes / 60, 'hr')}` : 'insufficient data'}</small>
        </div>
      </div>

      <div className="dashboard-body">
        {/* Status breakdown */}
        <section className="panel">
          <div className="section-heading">
            <h2>Status breakdown</h2>
            <span className="mono" style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{data.total} total</span>
          </div>
          {data.total === 0
            ? <Empty title="No incident records."><p>Reports will appear once workers submit observations.</p></Empty>
            : <div className="dash-status-list">
                {STATUS_ORDER.filter(s => (data.counts[s] ?? 0) > 0).map(s => {
                  const count = data.counts[s] ?? 0
                  const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0
                  return <div key={s} className="dash-status-row">
                    <span className="dash-status-label">{STATUS_LABELS[s] ?? readable(s)}</span>
                    <div className="dash-bar-track">
                      <div
                        className={`dash-bar ${OPEN_STATUSES.has(s) ? 'dash-bar-open' : s === 'resolved' ? 'dash-bar-resolved' : 'dash-bar-cancelled'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="dash-status-count">{count}</span>
                  </div>
                })}
              </div>
          }
        </section>

        <div className="dashboard-right">
          {/* Priority distribution */}
          <section className="panel">
            <div className="section-heading"><h2>Priority split</h2></div>
            {Object.keys(data.priority_counts).length === 0
              ? <p className="muted" style={{ padding: '0 28px 22px', fontSize: '.85rem' }}>No data.</p>
              : <div className="dash-priority-grid">
                  {(['critical', 'high', 'medium', 'low'] as const).filter(p => (data.priority_counts[p] ?? 0) > 0).map(p => (
                    <div key={p} className={`dash-priority-cell dash-priority-${p}`}>
                      <span>{p}</span>
                      <strong>{data.priority_counts[p] ?? 0}</strong>
                    </div>
                  ))}
                </div>
            }
          </section>

          {/* Asset frequency */}
          {data.asset_frequency.length > 0 && (
            <section className="panel">
              <div className="section-heading"><h2>Most reported assets</h2></div>
              <div className="dash-asset-list">
                {data.asset_frequency.map((row, i) => (
                  <div key={row.code} className="dash-asset-row">
                    <span className="dash-asset-rank mono">{i + 1}</span>
                    <div className="dash-asset-info">
                      <strong>{row.code}</strong>
                      <span>{row.name}</span>
                      <span className="muted">{row.area}</span>
                    </div>
                    <span className="dash-asset-count">{row.total_count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Recent resolutions */}
      {data.recent_resolved.length > 0 && (
        <section className="panel">
          <div className="section-heading"><h2>Recent resolutions</h2></div>
          <div className="dash-resolution-table">
            <div className="dash-table-head">
              <span>Report</span>
              <span>Opened</span>
              <span>Closed</span>
              <span>Duration</span>
            </div>
            {data.recent_resolved.map(row => (
              <div key={row.number} className="dash-table-row">
                <span className="mono">{row.number}</span>
                <span>{shortDate(row.created_at)}</span>
                <span>{shortDate(row.resolved_at)}</span>
                <span className="dash-duration">{fmt(row.duration_minutes / 60, 'hr')}</span>
              </div>
            ))}
          </div>
          <p className="field-help" style={{ padding: '0 28px 20px' }}>
            Duration calculated from submission to server-confirmed close. Not a compliance metric.
          </p>
        </section>
      )}
    </>}
  </>
}
