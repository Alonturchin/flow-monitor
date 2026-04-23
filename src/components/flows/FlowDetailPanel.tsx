'use client'

import { useState, useEffect } from 'react'
import type { FlowSnapshot, MessageSnapshot } from '@/types'
import type { FlowDetail } from '@/lib/queries'
import { calcHealthScore, healthLabel } from '@/lib/health-score'
import type { AlertWithFlow } from '@/lib/alert-engine'

interface FlowDetailPanelProps {
  flowId: string
  onClose: () => void
}

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

const ALERT_SEV: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning:  'bg-yellow-100 text-yellow-700',
  info:     'bg-blue-100 text-blue-600',
}

const METRIC_LABELS: Record<string, string> = {
  spam_complaint_rate: 'Spam',
  bounce_rate:         'Bounce',
  unsubscribe_rate:    'Unsub',
  open_rate:           'Open rate',
  click_rate:          'Click rate',
}

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

// ─── Metric tile ─────────────────────────────────────────────────────────────

interface MetricTileProps {
  label: string
  value: string
  sub?: string
  subColor?: string
  highlight?: boolean
}

function MetricTile({ label, value, sub, subColor, highlight }: MetricTileProps) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      {sub && (
        <p className={`text-xs mt-0.5 ${subColor ?? 'text-gray-400'}`}>{sub}</p>
      )}
    </div>
  )
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-5">
      <div className="h-5 bg-gray-200 rounded w-3/4" />
      <div className="grid grid-cols-2 gap-3">
        {[0,1,2,3].map(i => <div key={i} className="h-20 bg-gray-200 rounded-lg" />)}
      </div>
      <div className="h-32 bg-gray-200 rounded-lg" />
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function FlowDetailPanel({ flowId, onClose }: FlowDetailPanelProps) {
  const [detail, setDetail]       = useState<FlowDetail | null>(null)
  const [alerts, setAlerts]       = useState<AlertWithFlow[]>([])
  const [loading, setLoading]     = useState(true)
  const [analysis, setAnalysis]   = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [msgNames, setMsgNames]   = useState<Record<string, string>>({})

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    setAlerts([])
    setAnalysis('')
    setAnalysisOpen(false)
    setMsgNames({})

    Promise.all([
      fetch(`/api/flows/${flowId}`).then(r => r.json()),
      fetch(`/api/alerts?flow_id=${flowId}`).then(r => r.json()),
    ]).then(([detailData, alertData]) => {
      setDetail(detailData)
      setAlerts(alertData.alerts ?? [])

      // If any messages are missing names, fetch them from Klaviyo
      const msgs: MessageSnapshot[] = detailData?.messages ?? []
      const hasMissing = msgs.some(m => !m.message_name)
      if (hasMissing) {
        fetch(`/api/flows/${flowId}/messages`)
          .then(r => r.json())
          .then(d => setMsgNames(d.names ?? {}))
          .catch(() => {})
      }
    }).catch(console.error).finally(() => setLoading(false))
  }, [flowId])

  async function handleAnalyze() {
    setIsAnalyzing(true)
    setAnalysisOpen(true)
    try {
      const res = await fetch(`/api/analyze/${flowId}`)
      const data = await res.json()
      setAnalysis(data.analysis ?? data.error ?? 'No analysis returned')
    } catch (err) {
      setAnalysis(`Error: ${String(err)}`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const snap = detail?.snapshot ?? null
  const prev = detail?.prevSnapshot ?? null
  const flow = detail?.flow ?? null
  const messages: MessageSnapshot[] = detail?.messages ?? []

  const alertBreakdown = {
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning:  alerts.filter(a => a.severity === 'warning').length,
    info:     alerts.filter(a => a.severity === 'info').length,
    totalMessages: messages.length || undefined,
  }
  const score = calcHealthScore(snap ?? {}, alertBreakdown)
  const { label, color } = healthLabel(score)

  const criticalCount = alerts.filter(a => a.severity === 'critical').length

  // Revenue trend
  const revTrend =
    prev?.revenue != null && prev.revenue > 0
      ? `${(((snap?.revenue ?? 0) - prev.revenue) / prev.revenue * 100).toFixed(0)}% vs prev`
      : 'no prior week'
  const revTrendColor =
    prev?.revenue != null && prev.revenue > 0
      ? (snap?.revenue ?? 0) >= prev.revenue ? 'text-green-600' : 'text-red-500'
      : 'text-gray-400'

  // Bounce highlight
  const bounceVal = snap?.bounce_rate != null ? Number(snap.bounce_rate) : 0
  const bounceHighlight = bounceVal > 0.02

  // Open rate context
  const openSub =
    prev?.open_rate != null && prev.open_rate > 0
      ? `prev ${fmt(prev.open_rate, true)}`
      : undefined

  return (
    <div className="w-[420px] shrink-0 bg-white border-l border-gray-200 flex flex-col h-screen sticky top-0 overflow-y-auto">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {flow ? (
            <>
              <a
                href={`https://www.klaviyo.com/flow/${flow.flow_id}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-gray-900 text-sm leading-tight hover:text-blue-600 hover:underline"
              >
                {flow.name}
              </a>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${HEALTH_COLOR[color]}`}>
                  {score} · {label}
                </span>
                {(flow.tags ?? []).map(tag => {
                  const [bg, txt] = tagColor(tag)
                  return (
                    <span key={tag} className={`text-xs px-2 py-0.5 rounded-full font-medium ${bg} ${txt}`}>
                      {tag}
                    </span>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
          )}
        </div>
        <button onClick={onClose} className="ml-3 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* ── Active alerts ── */}
          {alerts.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-100 space-y-1.5 bg-red-50">
              <p className="text-xs font-medium text-red-600 uppercase tracking-wide">
                {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
                {criticalCount > 0 && ` · ${criticalCount} critical`}
              </p>
              {alerts.map((a) => {
                // Try to find the message name from the messages list
                const msgName = a.message_name
                  ?? (a.message_id ? msgNames[a.message_id] : null)
                  ?? (a.message_id ? messages.find(m => m.message_id === a.message_id)?.message_name : null)
                const msgLabel = msgName ?? (a.message_id ? `Email ${a.message_id.slice(0, 6)}` : null)
                return (
                  <div key={a.id} className="flex items-start justify-between text-xs gap-2">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${ALERT_SEV[a.severity]}`}>
                        {a.severity}
                      </span>
                      {msgLabel && (
                        a.message_id ? (
                          <a
                            href={`https://www.klaviyo.com/flow/message/${a.message_id}/reports/overview`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-600 hover:text-blue-600 hover:underline truncate max-w-[120px]"
                            title={msgName ?? a.message_id}
                          >
                            {msgLabel}
                          </a>
                        ) : (
                          <span className="text-gray-500 truncate max-w-[120px]">{msgLabel}</span>
                        )
                      )}
                    </div>
                    <span className="text-gray-600 shrink-0">
                      {METRIC_LABELS[a.metric] ?? a.metric}: <span className="font-semibold">{fmt(a.value, true)}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── 2×2 Metric tiles (like example) ── */}
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="grid grid-cols-2 gap-3">
              <MetricTile
                label="Health score"
                value={`${score} / 100`}
                sub={criticalCount > 0 ? `↓ ${criticalCount} critical issue${criticalCount !== 1 ? 's' : ''}` : `${alerts.length} issue${alerts.length !== 1 ? 's' : ''}`}
                subColor={criticalCount > 0 ? 'text-red-500' : undefined}
              />
              <MetricTile
                label="Revenue"
                value={fmtRevenue(snap?.revenue)}
                sub={revTrend}
                subColor={revTrendColor}
              />
              <MetricTile
                label="Open rate"
                value={fmt(snap?.open_rate, true)}
                sub={openSub}
              />
              <MetricTile
                label="Bounce rate"
                value={fmt(snap?.bounce_rate, true)}
                highlight={bounceHighlight}
                sub={bounceHighlight ? 'Threshold: 2%' : undefined}
                subColor={bounceHighlight ? 'text-red-500' : undefined}
              />
            </div>
          </div>

          {/* ── Full metrics row ── */}
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Recipients',  value: fmt(snap?.recipients) },
                { label: 'Click rate',  value: fmt(snap?.click_rate, true) },
                { label: 'Unsub rate',  value: fmt(snap?.unsubscribe_rate, true) },
                { label: 'Spam rate',   value: fmt(snap?.spam_complaint_rate, true) },
              ].map(({ label: lbl, value }) => (
                <div key={lbl}>
                  <p className="text-xs text-gray-400">{lbl}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── AI analysis (collapsible) ── */}
          <div className="px-5 py-3 border-b border-gray-100">
            <button
              onClick={() => analysisOpen ? setAnalysisOpen(false) : handleAnalyze()}
              className="w-full flex items-center justify-between text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors"
            >
              <span>AI Analysis</span>
              <span>{analysisOpen ? '▲' : '▼'}</span>
            </button>
            {analysisOpen && (
              <div className="mt-3">
                {isAnalyzing ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analyzing…
                  </div>
                ) : analysis ? (
                  <>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{analysis}</p>
                    <button onClick={handleAnalyze} className="mt-2 text-xs text-blue-600 hover:underline">
                      Re-analyze
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Message breakdown table (full data like example) ── */}
          <div className="px-5 py-4 flex-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
              Message breakdown{messages.length > 0 ? ` (${messages.length})` : ''}
            </p>
            {messages.length === 0 ? (
              <p className="text-xs text-gray-400">No message data yet. Pull data to populate.</p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-200">
                      <th className="text-left pb-2 font-medium pl-1">Message</th>
                      <th className="text-right pb-2 font-medium">Recip</th>
                      <th className="text-right pb-2 font-medium">Open</th>
                      <th className="text-right pb-2 font-medium">Click</th>
                      <th className="text-right pb-2 font-medium">Bounce</th>
                      <th className="text-right pb-2 font-medium">Unsub</th>
                      <th className="text-right pb-2 font-medium">Spam</th>
                      <th className="text-right pb-2 font-medium pr-1">Rev</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {messages.map((msg) => {
                      const isHighBounce = msg.bounce_rate != null && Number(msg.bounce_rate) > 0.02
                      const isHighSpam   = msg.spam_complaint_rate != null && Number(msg.spam_complaint_rate) > 0.002
                      const isHighUnsub  = msg.unsubscribe_rate != null && Number(msg.unsubscribe_rate) > 0.015
                      const isLowOpen    = msg.open_rate != null && Number(msg.open_rate) < 0.10 && (msg.recipients ?? 0) > 100
                      return (
                        <tr key={msg.message_id} className="hover:bg-gray-50">
                          <td className="py-2 pl-1 pr-1 text-gray-700 font-medium truncate max-w-[100px]" title={msg.message_name ?? msgNames[msg.message_id] ?? msg.message_id}>
                            <a
                              href={`https://www.klaviyo.com/flow/message/${msg.message_id}/reports/overview`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-600 hover:underline"
                            >
                              {msg.message_name ?? msgNames[msg.message_id] ?? msg.message_id.slice(0, 6)}
                            </a>
                          </td>
                          <td className="py-2 text-right text-gray-600">{fmt(msg.recipients)}</td>
                          <td className={`py-2 text-right ${isLowOpen ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                            {fmt(msg.open_rate, true)}
                          </td>
                          <td className="py-2 text-right text-gray-700">{fmt(msg.click_rate, true)}</td>
                          <td className={`py-2 text-right ${isHighBounce ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                            {fmt(msg.bounce_rate, true)}
                          </td>
                          <td className={`py-2 text-right ${isHighUnsub ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                            {fmt(msg.unsubscribe_rate, true)}
                          </td>
                          <td className={`py-2 text-right ${isHighSpam ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                            {msg.spam_complaint_rate != null ? fmt(msg.spam_complaint_rate, true) : '0.0%'}
                          </td>
                          <td className="py-2 text-right pr-1 text-gray-700">
                            {fmtRevenue(msg.revenue)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Analyze button ── */}
          {!analysisOpen && (
            <div className="px-5 py-4 border-t border-gray-100">
              <button
                onClick={handleAnalyze}
                className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-md transition-colors font-medium"
              >
                Analyze with AI
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
