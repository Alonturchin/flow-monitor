'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import type { FlowRow } from '@/components/dashboard/FlowsTable'
import type { AlertWithFlow } from '@/lib/alert-engine'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
  onTestsCreated?: () => void
}

interface MessageOption {
  flow_id: string
  flow_name: string
  message_id: string
  message_name: string | null
  alertCount: number
  alertSeverity: 'critical' | 'warning' | 'info' | null
  recipients: number
  openRate: number | null
  clickRate: number | null
}

interface Suggestion {
  hypothesis: string
  suggested_change: string
  metric_to_watch: string
  confidence: number
  rationale?: string
  expected_impact?: string
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, isPercent = false) {
  if (n == null) return '—'
  if (isPercent) return `${(Number(n) * 100).toFixed(1)}%`
  return Number(n).toLocaleString()
}

const METRIC_LABELS: Record<string, string> = {
  open_rate: 'Open rate',
  click_rate: 'Click rate',
  bounce_rate: 'Bounce rate',
  unsubscribe_rate: 'Unsub rate',
  revenue: 'Revenue',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AbTestSuggestModal({ onClose, onTestsCreated }: Props) {
  const [options, setOptions] = useState<MessageOption[]>([])
  const [search, setSearch] = useState('')
  const [onlyWithAlerts, setOnlyWithAlerts] = useState(true)
  const [loadingList, setLoadingList] = useState(true)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [loadingChat, setLoadingChat] = useState(false)

  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [taskStatus, setTaskStatus] = useState<Record<number, 'idle' | 'creating' | 'done' | 'error'>>({})
  const [dismissedHypotheses, setDismissedHypotheses] = useState<Set<string>>(new Set())

  const chatBottomRef = useRef<HTMLDivElement>(null)

  // ─── Close on escape ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // ─── Load flows + alerts to build message options list ──
  useEffect(() => {
    async function load() {
      try {
        const [flowsRes, alertsRes] = await Promise.all([
          fetch('/api/flows').then(r => r.json()),
          fetch('/api/alerts').then(r => r.json()),
        ])
        const flows: FlowRow[] = flowsRes.rows ?? []
        const alerts: AlertWithFlow[] = alertsRes.alerts ?? []

        // Group alerts by message_id
        const alertByMsg = new Map<string, AlertWithFlow[]>()
        for (const a of alerts) {
          if (!a.message_id) continue
          const list = alertByMsg.get(a.message_id) ?? []
          list.push(a)
          alertByMsg.set(a.message_id, list)
        }

        // Fetch message-level data for all flows with alerts (batched by flow)
        const flowsWithAlerts = Array.from(new Set(alerts.filter(a => a.message_id).map(a => a.flow_id)))
        const msgFetches = flowsWithAlerts.map(fid =>
          fetch(`/api/flows/${fid}`).then(r => r.json()).catch(() => null)
        )
        const details = await Promise.all(msgFetches)

        const opts: MessageOption[] = []
        for (let i = 0; i < flowsWithAlerts.length; i++) {
          const detail = details[i]
          if (!detail?.flow || !detail?.messages) continue
          const flow = detail.flow
          if (flow.name?.toLowerCase().includes('eikona')) continue
          if ((flow.tags ?? []).some((t: string) => t.toLowerCase() === 'eikona')) continue

          for (const msg of detail.messages) {
            const msgAlerts = alertByMsg.get(msg.message_id) ?? []
            // Track top severity on this email
            let topSev: 'critical' | 'warning' | 'info' | null = null
            for (const a of msgAlerts) {
              if (a.severity === 'critical') { topSev = 'critical'; break }
              if (a.severity === 'warning') topSev = 'warning'
              else if (!topSev) topSev = 'info'
            }
            opts.push({
              flow_id: flow.flow_id,
              flow_name: flow.name,
              message_id: msg.message_id,
              message_name: msg.message_name ?? null,
              alertCount: msgAlerts.length,
              alertSeverity: topSev,
              recipients: Number(msg.recipients ?? 0),
              openRate: msg.open_rate != null ? Number(msg.open_rate) : null,
              clickRate: msg.click_rate != null ? Number(msg.click_rate) : null,
            })
          }
        }

        // Also include messages WITHOUT alerts from all flows (for the "show all" option)
        // We get those from the current flow detail responses as well
        for (let i = 0; i < details.length; i++) {
          const detail = details[i]
          if (!detail?.messages) continue
          // Already added alerting ones above; we only needed the alerting flows anyway
        }

        // Sort: by severity desc, then alert count desc, then recipients desc
        const sevRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
        opts.sort((a, b) => {
          const aSev = a.alertSeverity ? sevRank[a.alertSeverity] : 9
          const bSev = b.alertSeverity ? sevRank[b.alertSeverity] : 9
          if (aSev !== bSev) return aSev - bSev
          if (a.alertCount !== b.alertCount) return b.alertCount - a.alertCount
          return b.recipients - a.recipients
        })

        setOptions(opts)
      } catch (err) {
        console.error('[suggest-modal] load failed:', err)
      } finally {
        setLoadingList(false)
      }
    }
    load()
  }, [])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return options.filter((o) => {
      if (onlyWithAlerts && o.alertCount === 0) return false
      if (q && !o.message_name?.toLowerCase().includes(q) && !o.flow_name.toLowerCase().includes(q)) return false
      return true
    })
  }, [options, onlyWithAlerts, search])

  const selected = options.find(o => o.message_id === selectedId) ?? null

  // ─── Auto-load suggestions when email is selected ──
  useEffect(() => {
    if (!selectedId) return
    setSuggestions([])
    setChat([])
    setSavedIds(new Set())
    setDismissedHypotheses(new Set())
    loadSuggestions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  async function loadSuggestions(regenerate = false) {
    if (!selectedId) return
    setLoadingSuggestions(true)
    try {
      const avoid = regenerate
        ? [...suggestions.map(s => s.hypothesis), ...Array.from(dismissedHypotheses)]
        : Array.from(dismissedHypotheses)
      const res = await fetch('/api/ab-tests/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: selectedId, avoidHypotheses: avoid }),
      })
      const data = await res.json()
      if (data.suggestions) {
        setSuggestions(data.suggestions)
        if (regenerate) {
          setSavedIds(new Set())  // reset "saved" on regen
        }
      }
    } finally {
      setLoadingSuggestions(false)
    }
  }

  async function handleChat() {
    if (!selectedId || !chatInput.trim() || loadingChat) return
    const userMsg: ChatMsg = { role: 'user', content: chatInput.trim() }
    const nextHistory = [...chat, userMsg]
    setChat(nextHistory)
    setChatInput('')
    setLoadingChat(true)
    try {
      const res = await fetch('/api/ab-tests/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: selectedId, history: nextHistory }),
      })
      const data = await res.json()
      setChat([...nextHistory, { role: 'assistant', content: data.reply ?? `Error: ${data.error ?? 'unknown'}` }])
    } finally {
      setLoadingChat(false)
    }
  }

  async function saveTest(idx: number) {
    const s = suggestions[idx]
    if (!s || !selected || savedIds.has(idx)) return
    const res = await fetch('/api/ab-tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flow_id: selected.flow_id,
        message_id: selected.message_id,
        hypothesis: s.hypothesis,
        suggested_change: s.suggested_change,
        metric_to_watch: s.metric_to_watch,
        confidence: s.confidence,
        rationale: s.rationale,
        expected_impact: s.expected_impact,
      }),
    })
    if (res.ok) {
      setSavedIds(prev => new Set(prev).add(idx))
      onTestsCreated?.()
    }
  }

  async function addTask(idx: number) {
    const s = suggestions[idx]
    if (!s || !selected) return
    setTaskStatus(prev => ({ ...prev, [idx]: 'creating' }))
    try {
      // Short hypothesis for the task name
      const shortHypothesis = s.hypothesis.length > 80
        ? s.hypothesis.slice(0, 77) + '…'
        : s.hypothesis
      const emailLabel = selected.message_name ?? `Email ${selected.message_id.slice(0, 6)}`
      const name = `A/B Test: ${selected.flow_name} › ${emailLabel} — ${shortHypothesis}`

      const description = [
        `Flow: ${selected.flow_name}`,
        `Email: ${emailLabel}`,
        `Metric to watch: ${s.metric_to_watch}`,
        `Expected impact: ${s.expected_impact ?? 'n/a'}`,
        `Confidence: ${Math.round(s.confidence * 100)}%`,
        '',
        `HYPOTHESIS:`,
        s.hypothesis,
        '',
        `SUGGESTED CHANGE:`,
        s.suggested_change,
        '',
        `WHY THIS TEST:`,
        s.rationale ?? 'n/a',
      ].join('\n')

      const res = await fetch('/api/monday/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow_id: selected.flow_id,
          task_type: 'ab_test',
          name,
          description,
        }),
      })
      const data = await res.json()
      setTaskStatus(prev => ({ ...prev, [idx]: res.ok && data.ok ? 'done' : 'error' }))
    } catch {
      setTaskStatus(prev => ({ ...prev, [idx]: 'error' }))
    }
  }

  function dismissSuggestion(idx: number) {
    const s = suggestions[idx]
    if (!s) return
    setDismissedHypotheses(prev => new Set(prev).add(s.hypothesis))
    setSuggestions(prev => prev.filter((_, i) => i !== idx))
  }

  // ─── UI ──
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
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Suggest A/B tests</h2>
            <p className="text-xs text-gray-500 mt-0.5">Select an email to get AI-powered test suggestions grounded in real metrics.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* ═══ LEFT: email list ═══ */}
          <div className="w-[380px] shrink-0 flex flex-col overflow-hidden border-r border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2 shrink-0">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search emails…"
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithAlerts}
                  onChange={(e) => setOnlyWithAlerts(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                Only emails with alerts
              </label>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="animate-pulse p-4 space-y-2">
                  {[0,1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded" />)}
                </div>
              ) : filteredOptions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8 px-4">
                  {onlyWithAlerts ? 'No emails with alerts. Uncheck the filter to see all.' : 'No emails match.'}
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredOptions.map((o) => {
                    const isSelected = selectedId === o.message_id
                    return (
                      <button
                        key={o.message_id}
                        onClick={() => setSelectedId(o.message_id)}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          isSelected
                            ? 'bg-blue-50 border-l-4 border-blue-500 pl-3'
                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          {o.alertSeverity === 'critical' && (
                            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                          )}
                          {o.alertSeverity === 'warning' && (
                            <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                          )}
                          {o.alertSeverity === 'info' && (
                            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                          )}
                          {o.alertCount > 0 && (
                            <span className="text-xs font-medium text-red-600">
                              {o.alertCount} alert{o.alertCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate" title={o.message_name ?? o.message_id}>
                          {o.message_name ?? `Email ${o.message_id.slice(0, 6)}`}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-0.5" title={o.flow_name}>
                          {o.flow_name}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                          <span>{fmt(o.recipients)} sent</span>
                          <span>{fmt(o.openRate, true)} open</span>
                          <span>{fmt(o.clickRate, true)} click</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ═══ RIGHT: suggestions + chat ═══ */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <div>
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <p className="text-sm text-gray-500">Select an email on the left to see AI test suggestions</p>
                </div>
              </div>
            ) : (
              <>
                {/* Selected email header */}
                <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Selected email</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                    {selected.message_name ?? `Email ${selected.message_id.slice(0, 6)}`}
                    <span className="font-normal text-gray-500"> — {selected.flow_name}</span>
                  </p>
                </div>

                {/* Suggestions list */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Test suggestions</p>
                    <button
                      onClick={() => loadSuggestions(true)}
                      disabled={loadingSuggestions}
                      className="text-xs px-3 py-1 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 rounded-md font-medium transition-colors"
                    >
                      {loadingSuggestions && suggestions.length > 0 ? 'Regenerating…' : '⟳ Regenerate different tests'}
                    </button>
                  </div>

                  {loadingSuggestions && suggestions.length === 0 ? (
                    <div className="animate-pulse space-y-3">
                      {[0,1].map(i => <div key={i} className="h-32 bg-gray-100 rounded-lg" />)}
                    </div>
                  ) : suggestions.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No suggestions. Try regenerating.</p>
                  ) : (
                    <div className="space-y-3">
                      {suggestions.map((s, idx) => {
                        const isSaved = savedIds.has(idx)
                        return (
                          <div key={idx} className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900">{s.hypothesis}</p>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                    {METRIC_LABELS[s.metric_to_watch] ?? s.metric_to_watch}
                                  </span>
                                  {s.expected_impact && (
                                    <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                      {s.expected_impact}
                                    </span>
                                  )}
                                  <span className="text-xs text-gray-500">
                                    {Math.round(s.confidence * 100)}% confidence
                                  </span>
                                </div>
                              </div>
                            </div>

                            {s.rationale && (
                              <div className="mt-2 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                                <p className="text-xs font-medium text-blue-800 mb-0.5">Why this test</p>
                                <p className="text-xs text-blue-900 leading-relaxed">{s.rationale}</p>
                              </div>
                            )}

                            <div className="mt-2 bg-gray-50 rounded-md px-3 py-2">
                              <p className="text-xs font-medium text-gray-500 mb-0.5">Suggested change</p>
                              <p className="text-sm text-gray-800">{s.suggested_change}</p>
                            </div>

                            {/* Actions */}
                            <div className="mt-3 flex gap-2 flex-wrap">
                              <button
                                onClick={() => saveTest(idx)}
                                disabled={isSaved}
                                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                                  isSaved
                                    ? 'bg-green-100 text-green-700 cursor-default'
                                    : 'bg-green-600 hover:bg-green-700 text-white'
                                }`}
                              >
                                {isSaved ? '✓ Saved as test' : '✓ Save as test'}
                              </button>
                              <button
                                onClick={() => dismissSuggestion(idx)}
                                className="text-xs px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 rounded-md font-medium transition-colors"
                              >
                                Dismiss
                              </button>
                              <button
                                onClick={() => addTask(idx)}
                                disabled={taskStatus[idx] === 'creating' || taskStatus[idx] === 'done'}
                                className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 rounded-md font-medium transition-colors"
                              >
                                {taskStatus[idx] === 'creating' ? 'Creating…'
                                  : taskStatus[idx] === 'done'    ? '✓ Task created'
                                  : taskStatus[idx] === 'error'   ? 'Retry task'
                                  : '+ Add task'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Chat */}
                  {suggestions.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-gray-200">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Ask follow-up</p>
                      <div className="space-y-2 mb-3">
                        {chat.map((m, i) => (
                          <div
                            key={i}
                            className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                              m.role === 'user'
                                ? 'bg-blue-600 text-white ml-auto max-w-[85%]'
                                : 'bg-gray-50 text-gray-800 border border-gray-200 max-w-[95%]'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                        ))}
                        {loadingChat && (
                          <div className="text-xs text-gray-400">Thinking…</div>
                        )}
                        <div ref={chatBottomRef} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Chat input */}
                {selected && suggestions.length > 0 && (
                  <div className="border-t border-gray-200 px-6 py-3 shrink-0 bg-white">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat() } }}
                        placeholder="e.g. What subject line angles would you recommend?"
                        disabled={loadingChat}
                        className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50"
                      />
                      <button
                        onClick={handleChat}
                        disabled={!chatInput.trim() || loadingChat}
                        className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-md font-medium transition-colors"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
