'use client'

import { useState, useEffect, useCallback } from 'react'
import TopBar from '@/components/layout/TopBar'
import type { AlertWithFlow } from '@/lib/alert-engine'

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', bg: 'bg-red-50', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  warning:  { label: 'Warning',  bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  info:     { label: 'Info',     bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
}

const METRIC_LABELS: Record<string, string> = {
  spam_complaint_rate: 'Spam complaint rate',
  bounce_rate:         'Bounce rate',
  unsubscribe_rate:    'Unsubscribe rate',
  open_rate:           'Open rate',
  click_rate:          'Click rate',
  revenue_drop:        'Revenue drop',
  open_rate_drop:      'Open rate drop',
  click_rate_drop:     'Click rate drop',
}

function fmt(n: number, metric: string) {
  const pct = ['spam_complaint_rate','bounce_rate','unsubscribe_rate','open_rate','click_rate','revenue_drop','open_rate_drop','click_rate_drop']
  return pct.includes(metric) ? `${(n * 100).toFixed(2)}%` : n.toLocaleString()
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatWeekRange(weekStart: string | null): string | null {
  if (!weekStart) return null
  const start = new Date(weekStart + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertWithFlow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [resolving, setResolving] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts')
      const data = await res.json()
      setAlerts(data.alerts ?? [])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function resolve(id: number) {
    setResolving(id)
    await fetch(`/api/alerts/${id}/resolve`, { method: 'POST' })
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    setResolving(null)
  }

  async function dismiss(id: number) {
    setResolving(id)
    await fetch(`/api/alerts/${id}/dismiss`, { method: 'POST' })
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    setResolving(null)
  }

  const bySeverity = (sev: AlertWithFlow['severity']) => alerts.filter((a) => a.severity === sev)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar
        title="All Alerts"
        subtitle={isLoading ? 'Loading…' : `${alerts.length} active alert${alerts.length !== 1 ? 's' : ''}`}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[0,1,2].map(i => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">All clear — no active alerts</p>
            <p className="text-xs mt-1">Alerts are generated automatically after each data pull</p>
          </div>
        ) : (
          (['critical', 'warning', 'info'] as const).map((sev) => {
            const group = bySeverity(sev)
            if (!group.length) return null
            const cfg = SEVERITY_CONFIG[sev]
            return (
              <section key={sev}>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
                  {cfg.label} · {group.length}
                </h2>
                <div className="space-y-2">
                  {group.map((alert) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      onResolve={resolve}
                      onDismiss={dismiss}
                      resolving={resolving === alert.id}
                      onAiSuggestionSaved={load}
                    />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

function AlertCard({
  alert,
  onResolve,
  onDismiss,
  resolving,
  onAiSuggestionSaved,
}: {
  alert: AlertWithFlow
  onResolve: (id: number) => void
  onDismiss: (id: number) => void
  resolving: boolean
  onAiSuggestionSaved: () => void
}) {
  const cfg = SEVERITY_CONFIG[alert.severity]
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [suggestion, setSuggestion] = useState(alert.ai_suggestion ?? '')
  const [showSuggestion, setShowSuggestion] = useState(!!alert.ai_suggestion)

  async function analyze() {
    setIsAnalyzing(true)
    try {
      const res = await fetch(`/api/analyze/${alert.flow_id}`)
      const data = await res.json()
      if (data.analysis) {
        setSuggestion(data.analysis)
        setShowSuggestion(true)
        onAiSuggestionSaved()
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className={`rounded-xl border border-gray-200 overflow-hidden ${cfg.bg}`}>
      <div className="px-4 py-3 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
              {cfg.label}
            </span>
            <a
              href={`https://www.klaviyo.com/flow/${alert.flow_id}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-gray-900 truncate hover:text-blue-600 hover:underline"
            >
              {alert.flow_name}
            </a>
            {alert.message_id && (
              <>
                <span className="text-gray-400 text-sm">›</span>
                <a
                  href={`https://www.klaviyo.com/flow/message/${alert.message_id}/reports/overview`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-700 truncate hover:text-blue-600 hover:underline"
                  title={alert.message_name ?? alert.message_id}
                >
                  {alert.message_name ?? `Email ${alert.message_id.slice(0, 6)}`}
                </a>
              </>
            )}
          </div>
          <p className="text-sm text-gray-700 mt-1">
            <span className="font-medium">{METRIC_LABELS[alert.metric] ?? alert.metric}</span>
            {' '}is{' '}
            <span className="font-semibold">{fmt(alert.value, alert.metric)}</span>
            {' '}(threshold: {fmt(alert.threshold, alert.metric)})
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatWeekRange(alert.week_start) && (
              <span className="text-gray-600 font-medium">Week of {formatWeekRange(alert.week_start)}</span>
            )}
            {formatWeekRange(alert.week_start) && <span className="mx-1.5">·</span>}
            Detected {relTime(alert.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={analyze}
            disabled={isAnalyzing}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {isAnalyzing ? 'Analyzing…' : 'Analyze'}
          </button>
          <button
            onClick={() => onResolve(alert.id)}
            disabled={resolving}
            className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white border border-green-600 rounded-md disabled:opacity-50 transition-colors"
          >
            {resolving ? '…' : '✓ Resolve'}
          </button>
          <button
            onClick={() => onDismiss(alert.id)}
            disabled={resolving}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors text-gray-500"
          >
            Dismiss
          </button>
        </div>
      </div>
      {showSuggestion && suggestion && (
        <div className="px-4 py-3 bg-white border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-1">AI Analysis</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{suggestion}</p>
        </div>
      )}
    </div>
  )
}
