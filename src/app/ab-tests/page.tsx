'use client'

import { useState, useEffect, useCallback } from 'react'
import TopBar from '@/components/layout/TopBar'
import AbTestSuggestModal from '@/components/ab-tests/AbTestSuggestModal'

interface AbTest {
  id: number
  flow_id: string
  flow_name: string
  message_id: string | null
  message_name: string | null
  hypothesis: string
  suggested_change: string
  metric_to_watch: string
  confidence: number
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed'
  result: string | null
  rationale: string | null
  expected_impact: string | null
  monday_task_id: string | null
  created_at: string
}

type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed'

const STATUS_CONFIG = {
  pending:     { label: 'Pending',     badge: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'In progress', badge: 'bg-blue-100 text-blue-700' },
  completed:   { label: 'Completed',   badge: 'bg-green-100 text-green-700' },
  dismissed:   { label: 'Dismissed',   badge: 'bg-gray-100 text-gray-400' },
}

const METRIC_LABELS: Record<string, string> = {
  open_rate:        'Open rate',
  click_rate:       'Click rate',
  unsubscribe_rate: 'Unsub rate',
  revenue:          'Revenue',
  bounce_rate:      'Bounce rate',
}

export default function AbTestsPage() {
  const [tests, setTests] = useState<AbTest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showSuggestModal, setShowSuggestModal] = useState(false)

  const loadTests = useCallback(async () => {
    try {
      const res = await fetch('/api/ab-tests')
      const data = await res.json()
      setTests(data.tests ?? [])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadTests() }, [loadTests])

  async function updateStatus(id: number, status: AbTest['status'], result?: string) {
    await fetch(`/api/ab-tests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, result }),
    })
    setTests((prev) => prev.map((t) => t.id === id ? { ...t, status, result: result ?? t.result } : t))
  }

  const filtered = tests.filter((t) => {
    // Exclude EIKONA tests
    if (t.flow_name?.toLowerCase().includes('eikona')) return false
    if (statusFilter === 'all') return t.status !== 'dismissed'
    return t.status === statusFilter
  })

  const counts = {
    all:         tests.filter((t) => t.status !== 'dismissed').length,
    pending:     tests.filter((t) => t.status === 'pending').length,
    in_progress: tests.filter((t) => t.status === 'in_progress').length,
    completed:   tests.filter((t) => t.status === 'completed').length,
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar
        title="A/B Tests"
        subtitle={isLoading ? 'Loading…' : `${counts.all} suggestion${counts.all !== 1 ? 's' : ''}`}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* Generate panel */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {(['all', 'pending', 'in_progress', 'completed'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === s
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {s === 'all' ? 'All' : s === 'in_progress' ? 'In progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                {' '}
                <span className="opacity-60">{counts[s]}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSuggestModal(true)}
            className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
          >
            ✨ Suggest tests with AI
          </button>
        </div>

        {showSuggestModal && (
          <AbTestSuggestModal
            onClose={() => setShowSuggestModal(false)}
            onTestsCreated={loadTests}
          />
        )}

        {/* Content */}
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-sm font-medium">No suggestions yet</p>
            <p className="text-xs mt-1">Click &ldquo;Generate tests&rdquo; to get AI-powered A/B test ideas</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((test) => (
              <TestCard key={test.id} test={test} onStatusChange={updateStatus} onTestUpdated={loadTests} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value >= 0.75 ? 'bg-green-500' : value >= 0.5 ? 'bg-yellow-400' : 'bg-gray-300'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  )
}

function TestCard({
  test,
  onStatusChange,
  onTestUpdated,
}: {
  test: AbTest
  onStatusChange: (id: number, status: AbTest['status'], result?: string) => void
  onTestUpdated?: () => void
}) {
  const [showResult, setShowResult] = useState(false)
  const [resultText, setResultText] = useState(test.result ?? '')
  const [taskStatus, setTaskStatus] = useState<'idle' | 'creating' | 'done' | 'error'>(
    test.monday_task_id ? 'done' : 'idle'
  )
  const cfg = STATUS_CONFIG[test.status]

  async function addToMonday() {
    setTaskStatus('creating')
    try {
      const shortHypothesis = test.hypothesis.length > 80
        ? test.hypothesis.slice(0, 77) + '…'
        : test.hypothesis
      const emailLabel = test.message_name ?? (test.message_id ? `Email ${test.message_id.slice(0, 6)}` : null)
      const name = emailLabel
        ? `A/B Test: ${test.flow_name} › ${emailLabel} — ${shortHypothesis}`
        : `A/B Test: ${test.flow_name} — ${shortHypothesis}`
      const description = [
        `Flow: ${test.flow_name}`,
        emailLabel ? `Email: ${emailLabel}` : null,
        `Metric to watch: ${test.metric_to_watch}`,
        test.expected_impact ? `Expected impact: ${test.expected_impact}` : null,
        `Confidence: ${Math.round(test.confidence * 100)}%`,
        '',
        `HYPOTHESIS:`,
        test.hypothesis,
        '',
        `SUGGESTED CHANGE:`,
        test.suggested_change,
        test.rationale ? '' : null,
        test.rationale ? 'WHY THIS TEST:' : null,
        test.rationale ?? null,
      ].filter(Boolean).join('\n')

      const res = await fetch('/api/monday/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow_id: test.flow_id,
          ab_test_id: test.id,
          task_type: 'ab_test',
          name,
          description,
        }),
      })
      const data = await res.json()
      setTaskStatus(res.ok && data.ok ? 'done' : 'error')
      if (res.ok) onTestUpdated?.()
    } catch {
      setTaskStatus('error')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            {/* Flow + message + status + metric */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium truncate max-w-[180px]">
                {test.flow_name}
              </span>
              {test.message_id && (
                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium truncate max-w-[160px]">
                  {test.message_name ?? `Email ${test.message_id.slice(0, 6)}`}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>
                {cfg.label}
              </span>
              <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                {METRIC_LABELS[test.metric_to_watch] ?? test.metric_to_watch}
              </span>
              {test.expected_impact && (
                <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  {test.expected_impact}
                </span>
              )}
            </div>

            {/* Hypothesis */}
            <p className="text-sm text-gray-800 leading-snug font-medium">{test.hypothesis}</p>

            {/* Rationale (why this test) */}
            {test.rationale && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-blue-800 mb-0.5">Why this test</p>
                <p className="text-xs text-blue-900 leading-relaxed">{test.rationale}</p>
              </div>
            )}

            {/* Suggested change */}
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs font-medium text-gray-500 mb-0.5">Suggested change</p>
              <p className="text-sm text-gray-700">{test.suggested_change}</p>
            </div>

            {/* Confidence */}
            <div>
              <p className="text-xs text-gray-400 mb-1">Confidence</p>
              <ConfidenceBar value={test.confidence} />
            </div>

            {/* Result (if completed) */}
            {test.result && (
              <div className="bg-green-50 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-green-700 mb-0.5">Result</p>
                <p className="text-sm text-gray-700">{test.result}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          {test.status !== 'completed' && test.status !== 'dismissed' && (
            <div className="shrink-0 flex flex-col gap-1.5">
              {test.status === 'pending' && (
                <button
                  onClick={() => onStatusChange(test.id, 'in_progress')}
                  className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors whitespace-nowrap"
                >
                  Start test
                </button>
              )}
              {test.status === 'in_progress' && (
                <button
                  onClick={() => setShowResult(true)}
                  className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors whitespace-nowrap"
                >
                  Mark complete
                </button>
              )}
              <button
                onClick={addToMonday}
                disabled={taskStatus === 'creating' || taskStatus === 'done'}
                className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 rounded-md font-medium transition-colors whitespace-nowrap"
              >
                {taskStatus === 'creating' ? 'Creating…'
                  : taskStatus === 'done'    ? '✓ In Monday'
                  : taskStatus === 'error'   ? 'Retry task'
                  : '+ Add to Monday'}
              </button>
              <button
                onClick={() => onStatusChange(test.id, 'dismissed')}
                className="text-xs px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-500 border border-gray-200 rounded-md transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Result input (inline when marking complete) */}
        {showResult && (
          <div className="mt-3 space-y-2">
            <textarea
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              placeholder="Describe the test result (optional)…"
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { onStatusChange(test.id, 'completed', resultText || undefined); setShowResult(false) }}
                className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
              >
                Save & complete
              </button>
              <button
                onClick={() => setShowResult(false)}
                className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
