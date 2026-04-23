'use client'

import { useState, useEffect } from 'react'
import TopBar from '@/components/layout/TopBar'
import type { AlertThresholds } from '@/lib/alert-thresholds'
import { DEFAULT_THRESHOLDS } from '@/lib/alert-thresholds'

interface ThresholdField {
  key: keyof AlertThresholds
  label: string
  description: string
  isPercent: boolean
  min: number
  max: number
  step: number
}

const THRESHOLD_FIELDS: ThresholdField[] = [
  { key: 'spam_critical',   label: 'Spam rate — critical',   description: 'Triggers a critical alert',  isPercent: true,  min: 0, max: 2,   step: 0.01  },
  { key: 'spam_warning',    label: 'Spam rate — warning',    description: 'Triggers a warning alert',   isPercent: true,  min: 0, max: 2,   step: 0.01  },
  { key: 'bounce_critical', label: 'Bounce rate — critical', description: 'Triggers a critical alert',  isPercent: true,  min: 0, max: 20,  step: 0.1   },
  { key: 'bounce_warning',  label: 'Bounce rate — warning',  description: 'Triggers a warning alert',   isPercent: true,  min: 0, max: 20,  step: 0.1   },
  { key: 'unsub_warning',   label: 'Unsub rate — warning',   description: 'Triggers a warning alert',   isPercent: true,  min: 0, max: 10,  step: 0.1   },
  { key: 'unsub_info',      label: 'Unsub rate — info',      description: 'Triggers an info alert',     isPercent: true,  min: 0, max: 10,  step: 0.1   },
  { key: 'open_critical',   label: 'Open rate — critical',   description: 'Below this = critical alert', isPercent: true,  min: 0, max: 50,  step: 0.5   },
  { key: 'open_info',       label: 'Open rate — info',       description: 'Below this = info alert',    isPercent: true,  min: 0, max: 50,  step: 0.5   },
  { key: 'click_info',      label: 'Click rate — info',      description: 'Below this = info alert',    isPercent: true,  min: 0, max: 10,  step: 0.1   },
  { key: 'min_recipients',  label: 'Min recipients',         description: 'Ignore ALL alerts for flows/emails below this volume', isPercent: false, min: 0, max: 5000, step: 50 },
  { key: 'revenue_drop_warning',  label: 'Revenue drop — warning',  description: 'Weekly revenue drop = warning alert',   isPercent: true,  min: 0, max: 100, step: 1 },
  { key: 'revenue_drop_critical', label: 'Revenue drop — critical', description: 'Weekly revenue drop = critical alert',  isPercent: true,  min: 0, max: 100, step: 1 },
  { key: 'revenue_drop_min',      label: 'Revenue drop — min $',    description: 'Skip flows with prior-week revenue below this ($)', isPercent: false, min: 0, max: 10000, step: 10 },
  { key: 'open_drop_warning',    label: 'Open rate drop — warning', description: 'Warning when open rate drops this much week-over-week',  isPercent: true,  min: 0, max: 100, step: 1 },
  { key: 'open_drop_critical',   label: 'Open rate drop — critical', description: 'Critical when open rate drops this much week-over-week', isPercent: true,  min: 0, max: 100, step: 1 },
  { key: 'click_drop_warning',   label: 'Click rate drop — warning', description: 'Warning when click rate drops this much week-over-week', isPercent: true,  min: 0, max: 100, step: 1 },
  { key: 'click_drop_critical',  label: 'Click rate drop — critical', description: 'Critical when click rate drops this much week-over-week', isPercent: true,  min: 0, max: 100, step: 1 },
]

function fmtDisplay(value: number, isPercent: boolean) {
  if (!isPercent) return value.toLocaleString()
  return `${(value * 100).toFixed(2)}%`
}

function toStored(display: string, isPercent: boolean): number {
  const n = parseFloat(display)
  return isPercent ? n / 100 : n
}

function toDisplay(stored: number, isPercent: boolean): string {
  if (!isPercent) return String(stored)
  return String(parseFloat((stored * 100).toFixed(4)))
}

export default function SettingsPage() {
  const [thresholds, setThresholds] = useState<AlertThresholds>(DEFAULT_THRESHOLDS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings?key=alert_thresholds')
      .then((r) => r.json())
      .then((d) => {
        if (d.value) setThresholds({ ...DEFAULT_THRESHOLDS, ...d.value })
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  async function handleSave() {
    setIsSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'alert_thresholds', value: thresholds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 6000)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsSaving(false)
    }
  }

  function handleChange(key: keyof AlertThresholds, displayValue: string, isPercent: boolean) {
    const stored = toStored(displayValue, isPercent)
    if (!isNaN(stored)) {
      setThresholds((prev) => ({ ...prev, [key]: stored }))
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Settings" subtitle="Alert thresholds and configuration" />
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[0,1,2,3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-6">

            {/* Alert thresholds */}
            <section>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-gray-900">Alert Thresholds</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Changes take effect on the next data pull. Percentages are entered as display values (e.g. 0.2 = 0.2%).
                </p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {THRESHOLD_FIELDS.map((field) => (
                  <div key={field.key} className="px-4 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{field.label}</p>
                      <p className="text-xs text-gray-400">{field.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        value={toDisplay(thresholds[field.key], field.isPercent)}
                        onChange={(e) => handleChange(field.key, e.target.value, field.isPercent)}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        className="w-24 text-sm text-right border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      {field.isPercent && (
                        <span className="text-xs text-gray-400 w-3">%</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 w-16 text-right shrink-0">
                      {fmtDisplay(thresholds[field.key], field.isPercent)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Save */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && (
                <span className="text-sm text-green-600 font-medium">✓ Saved — re-evaluating alerts in background…</span>
              )}
              {error && (
                <span className="text-sm text-red-600">{error}</span>
              )}
            </div>

            {/* Monday integration */}
            <MondayPanel />

            {/* Re-run alerts */}
            <RerunAlertsPanel />

            {/* Historical backfill */}
            <BackfillPanel />

            {/* Auth info */}
            <section className="pt-2 border-t border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Authentication</h2>
              <p className="text-xs text-gray-500">
                Login credentials are set via <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">AUTH_EMAIL</code> and{' '}
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">AUTH_PASSWORD</code> environment variables.
                Restart the container after changing them.
              </p>
            </section>

          </div>
        )}
      </div>
    </div>
  )
}

function MondayPanel() {
  const [boards, setBoards] = useState<{ id: string; name: string; workspace_name?: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; title: string }[]>([])
  const [boardId, setBoardId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Load current setting + boards
  useEffect(() => {
    Promise.all([
      fetch('/api/settings?key=monday').then(r => r.json()).catch(() => null),
      fetch('/api/monday/boards').then(r => r.json()).catch(() => ({ boards: [] })),
    ]).then(([saved, b]) => {
      if (b.error) setError(b.error)
      else setBoards(b.boards ?? [])
      if (saved?.value) {
        setBoardId(saved.value.board_id ?? '')
        setGroupId(saved.value.group_id ?? '')
      }
    }).finally(() => setLoading(false))
  }, [])

  // When board changes, load its groups
  useEffect(() => {
    if (!boardId) { setGroups([]); return }
    fetch(`/api/monday/boards?board_id=${boardId}`)
      .then(r => r.json())
      .then(d => setGroups(d.groups ?? []))
      .catch(() => setGroups([]))
  }, [boardId])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'monday',
          value: { board_id: boardId || null, group_id: groupId || null },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleTestTask() {
    setError('')
    try {
      const res = await fetch('/api/monday/test-task', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Test failed')
      else alert(`Test task created: ${data.task?.name ?? 'OK'}`)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <section className="pt-2 border-t border-gray-200">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Monday.com integration</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Pick the board (and optional group) where &ldquo;Add task&rdquo; buttons should create items.
          {!process.env.NEXT_PUBLIC_MONDAY_READY && ' '}
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        {loading ? (
          <p className="text-sm text-gray-400">Loading boards…</p>
        ) : boards.length === 0 ? (
          <p className="text-sm text-red-600">
            {error || 'No boards found. Is your MONDAY_API_KEY correct? Restart the server after changing .env.local.'}
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Board <span className="text-gray-400">({boards.length} available)</span>
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search boards by name or paste ID…"
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <select
                value={boardId}
                onChange={(e) => { setBoardId(e.target.value); setGroupId('') }}
                size={Math.min(8, Math.max(3, boards.filter(b =>
                  !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.id.includes(search)
                ).length + 1))}
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">— Select a board —</option>
                {boards
                  .filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.id.includes(search))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.workspace_name ? `  ·  ${b.workspace_name}` : ''}
                    </option>
                  ))}
              </select>
              {boardId && !boards.find(b => b.id === boardId) && (
                <p className="text-xs text-orange-600 mt-1">
                  Board ID {boardId} not in the list — will be used anyway when saved.
                </p>
              )}
            </div>

            {/* Manual ID entry */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Or paste a board ID directly
              </label>
              <input
                type="text"
                value={boardId}
                onChange={(e) => { setBoardId(e.target.value.trim()); setGroupId('') }}
                placeholder="e.g. 9993980489"
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
              />
            </div>

            {boardId && groups.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Group (optional)</label>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— Any / default group —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={!boardId || saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {boardId && (
                <button
                  onClick={handleTestTask}
                  className="text-sm px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg transition-colors"
                >
                  Create a test task
                </button>
              )}
              {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function RerunAlertsPanel() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ created: number; resolved: number; weekStart: string } | null>(null)
  const [error, setError] = useState('')

  async function handleRun() {
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/alerts/rerun', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setResult(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="pt-2 border-t border-gray-200">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Re-evaluate alerts</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Re-run the alert engine against existing snapshots in the database. Use this after changing thresholds,
          or to apply new alert types (like per-email revenue drops) to already-synced data. No Klaviyo call.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={running}
          className="px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {running ? 'Running…' : 'Re-run alert engine'}
        </button>
        {result && (
          <p className="text-xs text-green-700">
            ✓ Done. Created {result.created} new alert{result.created !== 1 ? 's' : ''},
            resolved {result.resolved}. (Week: {result.weekStart})
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  )
}

function BackfillPanel() {
  const [weeks, setWeeks] = useState(52)
  const [isBackfilling, setIsBackfilling] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number; currentWeek: string } | null>(null)
  const [error, setError] = useState('')

  // Poll progress every 5s while backfilling
  useEffect(() => {
    if (!isBackfilling) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/backfill')
        const data = await res.json()
        setIsBackfilling(data.isBackfilling)
        setProgress(data.progress)
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [isBackfilling])

  // Initial check: is a backfill already running?
  useEffect(() => {
    fetch('/api/backfill').then((r) => r.json()).then((d) => {
      setIsBackfilling(d.isBackfilling)
      setProgress(d.progress)
    }).catch(() => {})
  }, [])

  async function startBackfill() {
    setError('')
    try {
      const res = await fetch(`/api/backfill?weeks=${weeks}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to start')
        return
      }
      setIsBackfilling(true)
      setProgress(data.progress)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <section className="pt-2 border-t border-gray-200">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Historical Data Backfill</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Pull past weekly data from Klaviyo. Each week takes ~5 minutes due to API rate limits.
          Running this once gives the dashboard real historical comparison data.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        {isBackfilling && progress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">
                Backfilling… {progress.completed}/{progress.total} weeks
              </p>
              <span className="text-xs text-gray-500">
                Currently: {progress.currentWeek || 'starting…'}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${(progress.completed / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">
              Est. remaining: ~{Math.max(0, progress.total - progress.completed) * 5} min.
              You can leave this page — it runs in the background.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700">Weeks to pull:</label>
              <input
                type="number"
                value={weeks}
                onChange={(e) => setWeeks(Math.max(1, Math.min(104, parseInt(e.target.value, 10) || 52)))}
                min={1}
                max={104}
                className="w-20 text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-500">
                (≈ {Math.ceil((weeks * 5) / 60)} hour{Math.ceil((weeks * 5) / 60) !== 1 ? 's' : ''} total)
              </span>
            </div>
            <button
              onClick={startBackfill}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Start backfill
            </button>
            {progress && progress.completed > 0 && (
              <p className="text-xs text-green-700">
                ✓ Last backfill completed {progress.completed}/{progress.total} weeks
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </>
        )}
      </div>
    </section>
  )
}
