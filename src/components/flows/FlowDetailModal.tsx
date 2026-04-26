'use client'

import { useState, useEffect, useRef } from 'react'
import type { MessageSnapshot } from '@/types'
import type { FlowDetail } from '@/lib/queries'
import { calcHealthScore, healthLabel, type AlertCounts } from '@/lib/health-score'
import type { AlertWithFlow } from '@/lib/alert-engine'

interface Props {
  flowId: string
  onClose: () => void
  onAlertActioned?: (alertId: number) => void  // refresh dashboard after resolve/dismiss
}

// ─── formatters ──────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, isPercent = false) {
  if (n == null) return '—'
  if (isPercent) return `${(Number(n) * 100).toFixed(1)}%`
  return Number(n).toLocaleString()
}
function fmtRevenue(n: number | null | undefined) {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(0)}`
}

const HEALTH_COLOR: Record<string, string> = {
  green:  'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  red:    'bg-red-100 text-red-700',
}

const METRIC_LABELS: Record<string, string> = {
  spam_complaint_rate: 'Spam',
  bounce_rate:         'Bounce',
  unsubscribe_rate:    'Unsub',
  open_rate:           'Open rate',
  click_rate:          'Click rate',
  revenue_drop:        'Revenue drop',
}

const DELIVERABILITY_METRICS = new Set(['spam_complaint_rate', 'unsubscribe_rate', 'bounce_rate'])

const TAG_COLORS: [string, string][] = [
  ['bg-blue-100', 'text-blue-700'],
  ['bg-violet-100', 'text-violet-700'],
  ['bg-emerald-100', 'text-emerald-700'],
  ['bg-orange-100', 'text-orange-700'],
  ['bg-pink-100', 'text-pink-700'],
  ['bg-teal-100', 'text-teal-700'],
  ['bg-amber-100', 'text-amber-700'],
  ['bg-cyan-100', 'text-cyan-700'],
]
function tagColor(tag: string): [string, string] {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_COLORS[hash % TAG_COLORS.length]
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export default function FlowDetailModal({ flowId, onClose, onAlertActioned }: Props) {
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [alerts, setAlerts] = useState<AlertWithFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [msgNames, setMsgNames] = useState<Record<string, string>>({})

  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null)
  const [chatByAlert, setChatByAlert] = useState<Record<number, ChatMsg[]>>({})
  const [input, setInput] = useState('')
  const [loadingChat, setLoadingChat] = useState(false)
  const [actioning, setActioning] = useState<number | null>(null)
  const [taskStatus, setTaskStatus] = useState<Record<number, 'idle' | 'creating' | 'done' | 'error'>>({})

  // Timeframe selector: 'default' = stored week-over-week alerts, others = computed on-the-fly
  type TF = 'default' | '7d' | '30d' | '90d'
  const [timeframe, setTimeframe] = useState<TF>('default')
  const [loadingCompute, setLoadingCompute] = useState(false)

  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Load flow detail + alerts
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/flows/${flowId}`).then(r => r.json()),
      fetch(`/api/alerts?flow_id=${flowId}`).then(r => r.json()),
    ]).then(([d, a]) => {
      setDetail(d)
      const activeAlerts: AlertWithFlow[] = (a.alerts ?? []).filter((x: AlertWithFlow) => !x.resolved_at)
      setAlerts(activeAlerts)
      if (activeAlerts.length > 0) setSelectedAlertId(activeAlerts[0].id)

      // Auto-fetch message names if missing
      if ((d?.messages ?? []).some((m: MessageSnapshot) => !m.message_name)) {
        fetch(`/api/flows/${flowId}/messages`)
          .then(r => r.json())
          .then(res => setMsgNames(res.names ?? {}))
          .catch(() => {})
      }
    }).finally(() => setLoading(false))
  }, [flowId])

  // Re-fetch alerts when timeframe changes
  useEffect(() => {
    if (timeframe === 'default') {
      // Restore real DB alerts
      setLoadingCompute(true)
      setSelectedAlertId(null)
      setChatByAlert({})
      fetch(`/api/alerts?flow_id=${flowId}`)
        .then(r => r.json())
        .then(a => {
          const activeAlerts: AlertWithFlow[] = (a.alerts ?? []).filter((x: AlertWithFlow) => !x.resolved_at)
          setAlerts(activeAlerts)
          if (activeAlerts.length > 0) setSelectedAlertId(activeAlerts[0].id)
        })
        .catch(() => setAlerts([]))
        .finally(() => setLoadingCompute(false))
      return
    }

    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90
    const end = new Date()
    const start = new Date(end.getTime() - days * 86_400_000)
    const startStr = start.toISOString().slice(0, 10)
    const endStr = end.toISOString().slice(0, 10)

    setLoadingCompute(true)
    setSelectedAlertId(null)
    setChatByAlert({})
    fetch(`/api/alerts/compute?flow_id=${flowId}&start=${startStr}&end=${endStr}`)
      .then(r => r.json())
      .then(data => {
        // Map computed alerts to AlertWithFlow shape (id must be a number — we'll fake it)
        const computed: AlertWithFlow[] = (data.alerts ?? []).map((c: {
          id: string
          flow_id: string
          flow_name: string
          message_id: string | null
          message_name: string | null
          metric: string
          severity: 'critical' | 'warning'
          value: number
          threshold: number
          ai_suggestion: string
        }, i: number) => ({
          id: -1000 - i,  // negative IDs = synthetic
          flow_id: c.flow_id,
          flow_name: c.flow_name,
          message_id: c.message_id,
          message_name: c.message_name,
          metric: c.metric,
          severity: c.severity,
          value: c.value,
          threshold: c.threshold,
          ai_suggestion: c.ai_suggestion,
          monday_task_id: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
          week_start: startStr,
        }))
        setAlerts(computed)
        if (computed.length > 0) setSelectedAlertId(computed[0].id)
      })
      .catch(() => setAlerts([]))
      .finally(() => setLoadingCompute(false))
  }, [timeframe, flowId])

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedAlertId, chatByAlert])

  const snap = detail?.snapshot ?? null
  const flow = detail?.flow ?? null
  const messages: MessageSnapshot[] = detail?.messages ?? []
  const selectedAlert = alerts.find(a => a.id === selectedAlertId) ?? null

  const alertBreakdown: AlertCounts = {
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning:  alerts.filter(a => a.severity === 'warning').length,
    info:     alerts.filter(a => a.severity === 'info').length,
    totalMessages: messages.length || undefined,
  }
  const score = calcHealthScore(snap ?? {}, alertBreakdown)
  const { label, color } = healthLabel(score)

  // Map alerts to their message snapshot (if any)
  function getMessageForAlert(a: AlertWithFlow): MessageSnapshot | null {
    if (!a.message_id) return null
    return messages.find(m => m.message_id === a.message_id) ?? null
  }

  function nameForMessage(msgId: string | null, fallbackName: string | null): string {
    if (fallbackName) return fallbackName
    if (!msgId) return '—'
    return msgNames[msgId] ?? msgId.slice(0, 6)
  }

  const currentChat = selectedAlertId ? chatByAlert[selectedAlertId] ?? [] : []

  async function ensureInitialAnalysis() {
    if (!selectedAlert || currentChat.length > 0) return
    // Synthetic alerts (negative IDs) can't use the DB-backed analyze endpoint.
    // Show the stored rationale instead.
    if (selectedAlert.id < 0) {
      const suggestion = selectedAlert.ai_suggestion ?? 'No analysis available for this computed alert.'
      setChatByAlert(prev => ({
        ...prev,
        [selectedAlert.id]: [{ role: 'assistant', content: suggestion }],
      }))
      return
    }
    setLoadingChat(true)
    try {
      const res = await fetch('/api/analyze/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: selectedAlert.id }),
      })
      const data = await res.json()
      if (data.reply) {
        setChatByAlert(prev => ({
          ...prev,
          [selectedAlert.id]: [{ role: 'assistant', content: data.reply }],
        }))
      } else if (data.error) {
        setChatByAlert(prev => ({
          ...prev,
          [selectedAlert.id]: [{ role: 'assistant', content: `Error: ${data.error}` }],
        }))
      }
    } finally {
      setLoadingChat(false)
    }
  }

  // Auto-load initial analysis when an alert is selected
  useEffect(() => {
    if (!selectedAlertId) return
    if (chatByAlert[selectedAlertId]) return
    ensureInitialAnalysis()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlertId])

  async function sendMessage() {
    if (!selectedAlert || !input.trim() || loadingChat) return
    if (selectedAlert.id < 0) return  // no chat for synthetic alerts
    const userMsg: ChatMsg = { role: 'user', content: input.trim() }
    const nextHistory = [...currentChat, userMsg]
    setChatByAlert(prev => ({ ...prev, [selectedAlert.id]: nextHistory }))
    setInput('')
    setLoadingChat(true)
    try {
      const res = await fetch('/api/analyze/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: selectedAlert.id, history: nextHistory }),
      })
      const data = await res.json()
      const assistantMsg: ChatMsg = {
        role: 'assistant',
        content: data.reply ?? `Error: ${data.error ?? 'unknown'}`,
      }
      setChatByAlert(prev => ({
        ...prev,
        [selectedAlert.id]: [...nextHistory, assistantMsg],
      }))
    } finally {
      setLoadingChat(false)
    }
  }

  async function handleAction(id: number, action: 'resolve' | 'dismiss') {
    setActioning(id)
    try {
      await fetch(`/api/alerts/${id}/${action}`, { method: 'POST' })
      setAlerts(prev => prev.filter(a => a.id !== id))
      // Select next alert if current was removed
      if (selectedAlertId === id) {
        const remaining = alerts.filter(a => a.id !== id)
        setSelectedAlertId(remaining[0]?.id ?? null)
      }
      onAlertActioned?.(id)
    } finally {
      setActioning(null)
    }
  }

  async function handleAddTask(alertId: number) {
    if (!flow) return
    const alert = alerts.find((a) => a.id === alertId)
    if (!alert) return

    setTaskStatus(prev => ({ ...prev, [alertId]: 'creating' }))
    try {
      // Compute the exact date range for this alert's week (Sun–Sat)
      const weekStart = alert.week_start
      let dateRangeText = ''
      if (weekStart) {
        const start = new Date(weekStart + 'T00:00:00')
        const end = new Date(start)
        end.setDate(end.getDate() + 6)
        const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
        dateRangeText = `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
      }

      // Full email name (not truncated) + Klaviyo link
      const fullEmailName = alert.message_name
        ?? (alert.message_id ? msgNames[alert.message_id] : null)
        ?? (alert.message_id ? messages.find(m => m.message_id === alert.message_id)?.message_name : null)
        ?? null

      const flowLink = `https://www.klaviyo.com/flow/${flow.flow_id}/edit`
      const emailLink = alert.message_id
        ? `https://www.klaviyo.com/flow/message/${alert.message_id}/reports/overview`
        : null

      const metricLabel = METRIC_LABELS[alert.metric] ?? alert.metric
      const isDropMetric = alert.metric.endsWith('_drop')
      const valueText = isDropMetric
        ? `${(alert.value * 100).toFixed(1)}% drop`
        : `${(alert.value * 100).toFixed(2)}%`
      const thresholdText = isDropMetric
        ? `${(alert.threshold * 100).toFixed(0)}%+ drop`
        : `${(alert.threshold * 100).toFixed(2)}%`

      const { messageDetail, suggestion } = (() => {
        const text = alert.ai_suggestion ?? ''
        const aiIdx = text.indexOf('AI suggestion:')
        if (aiIdx === -1) return { messageDetail: text.trim() || null, suggestion: null }
        return {
          messageDetail: text.slice(0, aiIdx).trim() || null,
          suggestion: text.slice(aiIdx + 'AI suggestion:'.length).trim() || null,
        }
      })()

      // Rich task name — up to ~100 chars of flow + email + metric
      const taskName = emailLink && fullEmailName
        ? `[${alert.severity.toUpperCase()}] ${flow.name} › ${fullEmailName} — ${metricLabel}: ${valueText}`
        : `[${alert.severity.toUpperCase()}] ${flow.name} — ${metricLabel}: ${valueText}`

      // Task description (goes in Monday as an update / comment — supports URLs)
      const lines = [
        `FLOW: ${flow.name}`,
        `  → ${flowLink}`,
        '',
        fullEmailName ? `EMAIL: ${fullEmailName}` : `SCOPE: Entire flow`,
        emailLink ? `  → ${emailLink}` : null,
        '',
        `METRIC: ${metricLabel}`,
        `CURRENT VALUE: ${valueText}`,
        `THRESHOLD: ${thresholdText}`,
        `SEVERITY: ${alert.severity}`,
        dateRangeText ? `DATA WEEK: ${dateRangeText}` : null,
        '',
        messageDetail ? `DETAILS:` : null,
        messageDetail || null,
        suggestion ? '' : null,
        suggestion ? `AI SUGGESTION:` : null,
        suggestion || null,
      ].filter(Boolean).join('\n')

      const res = await fetch('/api/monday/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow_id: flow.flow_id,
          alert_id: alertId,
          task_type: 'alert',
          name: taskName,
          description: lines,
        }),
      })
      const data = await res.json()
      setTaskStatus(prev => ({ ...prev, [alertId]: res.ok && data.ok ? 'done' : 'error' }))
    } catch {
      setTaskStatus(prev => ({ ...prev, [alertId]: 'error' }))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between shrink-0">
          {flow ? (
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">
                <a
                  href={`https://www.klaviyo.com/flow/${flow.flow_id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-600 hover:underline"
                >
                  {flow.name}
                </a>
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${HEALTH_COLOR[color]}`}>
                  {score} · {label}
                </span>
                {alerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                    {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
                  </span>
                )}
                {(flow.tags ?? []).map(tag => {
                  const [bg, txt] = tagColor(tag)
                  return (
                    <span key={tag} className={`text-xs px-2 py-0.5 rounded-full font-medium ${bg} ${txt}`}>
                      {tag}
                    </span>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="h-6 w-1/3 bg-gray-200 rounded animate-pulse" />
          )}
          <button
            onClick={onClose}
            className="ml-3 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 animate-pulse p-6 space-y-4">
            <div className="h-24 bg-gray-200 rounded-xl" />
            <div className="h-48 bg-gray-200 rounded-xl" />
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* ═══════ LEFT ═══════ */}
            <div className="flex-1 min-w-0 overflow-y-auto border-r border-gray-200">
              {/* Flow snapshot row */}
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Flow snapshot</p>
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { label: 'Recipients', value: fmt(snap?.recipients) },
                    { label: 'Open rate', value: fmt(snap?.open_rate, true) },
                    { label: 'Click rate', value: fmt(snap?.click_rate, true) },
                    { label: 'Bounce rate', value: fmt(snap?.bounce_rate, true) },
                    { label: 'Revenue', value: fmtRevenue(snap?.revenue) },
                  ].map(({ label: lbl, value }) => (
                    <div key={lbl} className="bg-white rounded-lg p-2.5">
                      <p className="text-xs text-gray-500">{lbl}</p>
                      <p className="text-base font-bold text-gray-900 mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alerts list — one card per alert */}
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {timeframe === 'default' ? 'Active alerts' : 'Computed alerts'}
                    {alerts.length > 0 && <span className="text-gray-400 ml-2">({alerts.length})</span>}
                    {timeframe !== 'default' && (
                      <span className="ml-2 text-xs font-normal text-blue-600 normal-case">view-only</span>
                    )}
                  </p>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as TF)}
                    className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="default">Default (week-over-week)</option>
                    <option value="7d">Last 7 days vs prior 7</option>
                    <option value="30d">Last 30 days vs prior 30</option>
                    <option value="90d">Last 90 days vs prior 90</option>
                  </select>
                </div>

                {loadingCompute ? (
                  <div className="animate-pulse space-y-2">
                    {[0,1].map(i => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
                  </div>
                ) : alerts.length === 0 ? (
                  <p className="text-sm text-gray-400 py-8 text-center">
                    {timeframe === 'default'
                      ? 'No active alerts on this flow'
                      : 'No drops detected for this window'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {alerts.map((a) => {
                      const isSelected = selectedAlertId === a.id
                      const isCritical = a.severity === 'critical'
                      const msg = getMessageForAlert(a)
                      const name = nameForMessage(a.message_id, a.message_name ?? msg?.message_name ?? null)
                      const isDeliv = DELIVERABILITY_METRICS.has(a.metric)

                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelectedAlertId(a.id)}
                          className={`w-full text-left rounded-lg border transition-all ${
                            isSelected
                              ? isCritical
                                ? 'border-red-400 bg-red-50 ring-2 ring-red-200'
                                : 'border-orange-400 bg-orange-50 ring-2 ring-orange-200'
                              : isCritical
                                ? 'border-red-200 bg-red-50 hover:border-red-300'
                                : 'border-orange-200 bg-orange-50 hover:border-orange-300'
                          }`}
                        >
                          {/* Alert header */}
                          <div className="px-3 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    isDeliv ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'
                                  }`}>
                                    {isDeliv ? 'Deliverability' : 'Performance'}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    isCritical ? 'bg-red-200 text-red-800' : 'bg-orange-200 text-orange-800'
                                  }`}>
                                    {a.severity}
                                  </span>
                                  {!a.message_id && (
                                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                      Entire flow
                                    </span>
                                  )}
                                </div>
                                <p className={`text-sm font-semibold ${isCritical ? 'text-red-900' : 'text-orange-900'}`}>
                                  {a.message_id ? (
                                    <a
                                      href={`https://www.klaviyo.com/flow/message/${a.message_id}/reports/overview`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="hover:underline"
                                      title={name}
                                    >
                                      {name}
                                    </a>
                                  ) : (
                                    'Flow-level'
                                  )}{' — '}{METRIC_LABELS[a.metric] ?? a.metric}:{' '}
                                  {a.metric === 'revenue_drop'
                                    ? `${(a.value * 100).toFixed(0)}% drop`
                                    : fmt(a.value, true)}
                                </p>
                              </div>
                            </div>

                            {/* Message stats table (only if this alert has a message) */}
                            {msg && (
                              <div className="mt-2 -mx-3 px-3 pt-2 border-t border-black/5">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-gray-500">
                                      <th className="text-left font-medium pb-1">Recip</th>
                                      <th className="text-right font-medium pb-1">Open</th>
                                      <th className="text-right font-medium pb-1">Click</th>
                                      <th className="text-right font-medium pb-1">Bounce</th>
                                      <th className="text-right font-medium pb-1">Unsub</th>
                                      <th className="text-right font-medium pb-1">Spam</th>
                                      <th className="text-right font-medium pb-1">Rev</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr className="text-gray-800">
                                      <td>{fmt(msg.recipients)}</td>
                                      <td className="text-right">{fmt(msg.open_rate, true)}</td>
                                      <td className="text-right">{fmt(msg.click_rate, true)}</td>
                                      <td className={`text-right ${Number(msg.bounce_rate) > 0.02 ? 'text-red-600 font-medium' : ''}`}>
                                        {fmt(msg.bounce_rate, true)}
                                      </td>
                                      <td className={`text-right ${Number(msg.unsubscribe_rate) > 0.015 ? 'text-red-600 font-medium' : ''}`}>
                                        {fmt(msg.unsubscribe_rate, true)}
                                      </td>
                                      <td className={`text-right ${Number(msg.spam_complaint_rate) > 0.002 ? 'text-red-600 font-medium' : ''}`}>
                                        {fmt(msg.spam_complaint_rate, true)}
                                      </td>
                                      <td className="text-right">{fmtRevenue(msg.revenue)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ═══════ RIGHT ═══════ */}
            <div className="w-[460px] shrink-0 flex flex-col overflow-hidden bg-gray-50">
              {selectedAlert ? (
                <>
                  {/* Chat header */}
                  <div className="px-5 py-3 border-b border-gray-200 bg-white shrink-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI analysis</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate" title={selectedAlert.message_name ?? 'Flow-level'}>
                      {selectedAlert.message_id ? (
                        <a
                          href={`https://www.klaviyo.com/flow/message/${selectedAlert.message_id}/reports/overview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-blue-600 hover:underline"
                        >
                          {nameForMessage(selectedAlert.message_id, selectedAlert.message_name)}
                        </a>
                      ) : (
                        'Entire flow'
                      )}
                      {' — '}
                      {METRIC_LABELS[selectedAlert.metric] ?? selectedAlert.metric}
                    </p>
                  </div>

                  {/* Chat messages */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                    {currentChat.length === 0 && loadingChat && (
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Analyzing…
                      </div>
                    )}
                    {currentChat.map((msg, i) => (
                      <div
                        key={i}
                        className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white ml-auto max-w-[85%]'
                            : 'bg-white text-gray-800 border border-gray-200 max-w-[95%]'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}
                    {loadingChat && currentChat.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Thinking…
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  {/* Chat input */}
                  <div className="border-t border-gray-200 px-5 py-3 bg-white shrink-0">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                        placeholder="Ask a follow-up…"
                        disabled={loadingChat}
                        className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50"
                      />
                      <button
                        onClick={sendMessage}
                        disabled={!input.trim() || loadingChat}
                        className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-md font-medium transition-colors"
                      >
                        Send
                      </button>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="border-t border-gray-200 px-5 py-3 bg-white flex gap-2 shrink-0">
                    {selectedAlert.id < 0 ? (
                      <p className="flex-1 text-xs text-gray-400 text-center py-2">
                        Computed alerts are view-only. Switch to Default (week-over-week) to take action.
                      </p>
                    ) : (<>
                    <button
                      onClick={() => handleAction(selectedAlert.id, 'resolve')}
                      disabled={actioning === selectedAlert.id}
                      className="flex-1 text-sm px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
                    >
                      {actioning === selectedAlert.id ? '…' : '✓ Resolve'}
                    </button>
                    <button
                      onClick={() => handleAction(selectedAlert.id, 'dismiss')}
                      disabled={actioning === selectedAlert.id}
                      className="flex-1 text-sm px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 rounded-md font-medium transition-colors"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => handleAddTask(selectedAlert.id)}
                      disabled={taskStatus[selectedAlert.id] === 'creating' || taskStatus[selectedAlert.id] === 'done'}
                      className="flex-1 text-sm px-3 py-2 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 rounded-md font-medium transition-colors"
                    >
                      {taskStatus[selectedAlert.id] === 'creating' ? 'Creating…'
                        : taskStatus[selectedAlert.id] === 'done'    ? '✓ Task created'
                        : taskStatus[selectedAlert.id] === 'error'   ? 'Retry task'
                        : '+ Add task'}
                    </button>
                    </>)}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-8 text-center">
                  <p className="text-sm text-gray-400">
                    {alerts.length === 0
                      ? 'No alerts to analyze'
                      : 'Select an alert on the left to see AI analysis'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
