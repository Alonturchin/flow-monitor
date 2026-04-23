'use client'

import { useState } from 'react'
import type { AlertWithFlow } from '@/lib/alert-engine'

interface AlertsSectionProps {
  alerts: AlertWithFlow[]
  title?: string
  subtitle?: string
  showAll?: boolean  // show all alerts, not just top 5
  revenueByFlow?: Map<string, number>  // for sorting by revenue
  onAlertActioned?: (id: number) => void  // called after resolve/dismiss
}

const METRIC_LABELS: Record<string, string> = {
  spam_complaint_rate: 'Spam rate',
  bounce_rate: 'Bounce rate',
  unsubscribe_rate: 'Unsub rate',
  open_rate: 'Open rate',
  click_rate: 'Click rate',
  revenue_drop: 'Revenue drop',
  open_rate_drop: 'Open rate drop',
  click_rate_drop: 'Click rate drop',
}

const DELIVERABILITY_METRICS = new Set(['spam_complaint_rate', 'unsubscribe_rate', 'bounce_rate'])
const PERFORMANCE_METRICS   = new Set(['open_rate', 'click_rate', 'conversion_rate', 'revenue_drop', 'open_rate_drop', 'click_rate_drop'])

function categorize(metric: string): 'deliverability' | 'performance' | null {
  if (DELIVERABILITY_METRICS.has(metric)) return 'deliverability'
  if (PERFORMANCE_METRICS.has(metric))    return 'performance'
  return null
}

function CategoryBadge({ category }: { category: 'deliverability' | 'performance' }) {
  if (category === 'deliverability') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Deliverability
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
      Performance
    </span>
  )
}

function formatAlertDate(created_at: string): string {
  const date = new Date(created_at)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Returns "Apr 13 – Apr 19" from a week_start YYYY-MM-DD (Monday) */
function formatWeekRange(weekStart: string | null): string | null {
  if (!weekStart) return null
  const start = new Date(weekStart + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

function formatPct(value: number): string {
  return (value * 100).toFixed(1)
}

/** Split ai_suggestion into message details + AI suggestion parts */
function parseAlertDetail(text: string | null): { messageDetail: string | null; suggestion: string | null } {
  if (!text) return { messageDetail: null, suggestion: null }
  const aiIdx = text.indexOf('AI suggestion:')
  if (aiIdx === -1) return { messageDetail: text.trim() || null, suggestion: null }
  const before = text.slice(0, aiIdx).trim()
  const after = text.slice(aiIdx + 'AI suggestion:'.length).trim()
  return {
    messageDetail: before || null,
    suggestion: after || null,
  }
}

export default function AlertsSection({ alerts, title, subtitle, showAll, revenueByFlow, onAlertActioned }: AlertsSectionProps) {
  const [actioning, setActioning] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  async function handleAction(id: number, action: 'resolve' | 'dismiss') {
    setActioning(id)
    try {
      await fetch(`/api/alerts/${id}/${action}`, { method: 'POST' })
      onAlertActioned?.(id)
    } finally {
      setActioning(null)
    }
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Exclude EIKONA alerts (by flow name, case-insensitive)
  const nonEikona = alerts.filter((a) => !a.flow_name?.toLowerCase().includes('eikona'))

  if (nonEikona.length === 0) {
    if (title) {
      return (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400 mb-3">{subtitle}</p>}
          <p className="text-sm text-gray-400 py-6 text-center bg-white rounded-lg border border-gray-200">No alerts</p>
        </section>
      )
    }
    return null
  }

  // Sort: severity first, then flow revenue (higher first), then date desc
  const sorted = [...nonEikona]
    .sort((a, b) => {
      const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
      const sevDiff = (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9)
      if (sevDiff !== 0) return sevDiff

      // Within same severity: sort by flow revenue desc
      if (revenueByFlow) {
        const revA = revenueByFlow.get(a.flow_id) ?? 0
        const revB = revenueByFlow.get(b.flow_id) ?? 0
        if (revA !== revB) return revB - revA
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  const display = showAll ? sorted : sorted.slice(0, 5)

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-900">
          {title ?? 'Top alerts'}
          <span className="ml-2 text-xs font-normal text-gray-400">({nonEikona.length} total)</span>
        </h2>
        {!showAll && nonEikona.length > 5 && (
          <span className="text-xs text-gray-400">Showing top 5</span>
        )}
      </div>
      {subtitle && <p className="text-xs text-gray-400 mb-2">{subtitle}</p>}

      <div className="flex flex-col rounded-lg border border-gray-200 bg-white overflow-hidden">
        {display.map((alert, idx) => {
          const isCritical = alert.severity === 'critical'
          const metricLabel = METRIC_LABELS[alert.metric] ?? alert.metric
          const pct = formatPct(alert.value)
          const { messageDetail, suggestion } = parseAlertDetail(alert.ai_suggestion)
          const category = categorize(alert.metric)
          const isOpen = expanded.has(alert.id)
          const weekRange = formatWeekRange(alert.week_start)

          return (
            <div
              key={alert.id}
              className={`${idx > 0 ? 'border-t border-gray-100' : ''} ${
                isCritical ? 'bg-red-50/40' : 'bg-orange-50/40'
              }`}
            >
              {/* Compact single-line row */}
              <button
                onClick={() => toggleExpand(alert.id)}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-white/60 transition-colors"
              >
                {/* Severity dot */}
                <span
                  className={`shrink-0 w-2 h-2 rounded-full ${
                    isCritical ? 'bg-red-500' : 'bg-orange-400'
                  }`}
                />

                {/* Category pill — just one letter icon, compact */}
                {category === 'performance' && (
                  <span className="shrink-0 text-[10px] font-bold px-1.5 rounded bg-indigo-100 text-indigo-700" title="Performance">P</span>
                )}
                {category === 'deliverability' && (
                  <span className="shrink-0 text-[10px] font-bold px-1.5 rounded bg-purple-100 text-purple-700" title="Deliverability">D</span>
                )}

                {/* Flow + email + metric inline */}
                <div className="flex-1 min-w-0 flex items-center gap-1.5 text-sm">
                  <span className={`font-semibold truncate ${isCritical ? 'text-red-900' : 'text-orange-900'}`} title={alert.flow_name}>
                    {alert.flow_name}
                  </span>
                  {(alert.message_name || alert.message_id) && (
                    <>
                      <span className="text-gray-400">›</span>
                      <span className="text-gray-700 truncate" title={alert.message_name ?? alert.message_id ?? ''}>
                        {alert.message_name ?? `Email ${alert.message_id?.slice(0, 6)}`}
                      </span>
                    </>
                  )}
                </div>

                {/* Metric + value */}
                <span className={`shrink-0 text-xs font-semibold ${isCritical ? 'text-red-700' : 'text-orange-700'}`}>
                  {metricLabel}: {pct}%
                </span>

                {/* Week range */}
                {weekRange && (
                  <span className="shrink-0 text-xs text-gray-400 hidden md:inline">{weekRange}</span>
                )}

                {/* Expand chevron */}
                <svg
                  className={`shrink-0 w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-3 pb-3 pt-1 pl-9 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <a
                      href={`https://www.klaviyo.com/flow/${alert.flow_id}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open flow
                    </a>
                    {alert.message_id && (
                      <>
                        <span className="text-gray-300">·</span>
                        <a
                          href={`https://www.klaviyo.com/flow/message/${alert.message_id}/reports/overview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open email
                        </a>
                      </>
                    )}
                    {!alert.message_id && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-500">Entire flow</span>
                      </>
                    )}
                  </div>

                  {messageDetail && (
                    <p className={`text-xs leading-relaxed ${isCritical ? 'text-red-700' : 'text-orange-700'}`}>
                      {messageDetail}
                    </p>
                  )}

                  {suggestion && (
                    <div className={`rounded-md px-2.5 py-1.5 ${isCritical ? 'bg-red-100/60' : 'bg-orange-100/60'}`}>
                      <p className={`text-xs leading-relaxed ${isCritical ? 'text-red-800' : 'text-orange-800'}`}>
                        <span className="font-medium">AI suggestion:</span> {suggestion}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(alert.id, 'resolve') }}
                      disabled={actioning === alert.id}
                      className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-md hover:bg-gray-50 text-gray-700 font-medium disabled:opacity-50 transition-colors"
                    >
                      {actioning === alert.id ? '…' : '✓ Resolve'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction(alert.id, 'dismiss') }}
                      disabled={actioning === alert.id}
                      className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-md hover:bg-gray-50 text-gray-500 disabled:opacity-50 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
