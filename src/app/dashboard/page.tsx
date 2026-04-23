'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TopBar, { type DashboardFilters, DEFAULT_FILTERS } from '@/components/layout/TopBar'
import { calcHealthScore } from '@/lib/health-score'
import { computeDateRange } from '@/lib/date-range'
import MetricCards from '@/components/dashboard/MetricCards'
import AlertsSection from '@/components/dashboard/AlertsSection'
import FlowsList from '@/components/dashboard/FlowsList'
import { type FlowRow } from '@/components/dashboard/FlowsTable'
import FlowDetailModal from '@/components/flows/FlowDetailModal'
import type { AlertWithFlow } from '@/lib/alert-engine'
import type { DashboardTotals } from '@/lib/queries'

interface ApiResponse {
  rows: FlowRow[]
  lastPullTime: string | null
  totals: DashboardTotals
}

// ─── Inner (needs useSearchParams) ───────────────────────────────────────────

function DashboardContent() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') ?? 'overview'

  const [rows, setRows]               = useState<FlowRow[]>([])
  const [alerts, setAlerts]           = useState<AlertWithFlow[]>([])
  const [totals, setTotals]           = useState<DashboardTotals | null>(null)
  const [lastPullTime, setLastPullTime] = useState<string | null>(null)
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [isLoading, setIsLoading]     = useState(true)
  const [isPulling, setIsPulling]     = useState(false)
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)
  // `hydrated` toggles to true after the client reads localStorage.
  // This prevents the persist effect from clobbering saved filters on first render.
  const [hydrated, setHydrated] = useState(false)

  // Load persisted filters AFTER mount (client-only — avoids hydration mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dashboard.filters')
      if (saved) {
        const parsed = JSON.parse(saved)
        setFilters({ ...DEFAULT_FILTERS, ...parsed })
      }
    } catch {}
    setHydrated(true)
  }, [])

  // Persist on change — only after hydration is complete.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem('dashboard.filters', JSON.stringify(filters))
    } catch {}
  }, [filters, hydrated])

  const fetchData = useCallback(async (currentFilters: DashboardFilters) => {
    try {
      // Compute date range from filter
      const { start, end } = computeDateRange(currentFilters)
      const startStr = start.toISOString().slice(0, 10)
      const endStr = end.toISOString().slice(0, 10)
      const params = new URLSearchParams({
        start: startStr,
        end: endStr,
        compare: currentFilters.compareMode,
      })

      const [flowsRes, alertsRes] = await Promise.all([
        fetch(`/api/flows?${params.toString()}`),
        fetch('/api/alerts'),
      ])
      const flowsData: ApiResponse = await flowsRes.json()
      const alertsData             = await alertsRes.json()
      setRows(flowsData.rows ?? [])
      setLastPullTime(flowsData.lastPullTime ?? null)
      setTotals(flowsData.totals ?? null)
      setAlerts(alertsData.alerts ?? [])
    } catch (err) {
      console.error('[dashboard] Failed to load:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Refetch whenever date range / compare mode changes (DB is fast, no rate limits)
  useEffect(() => {
    fetchData(filters)
  }, [fetchData, filters.dateRange, filters.customStart, filters.customEnd, filters.compareMode])

  async function handlePull() {
    setIsPulling(true)
    try {
      const res = await fetch('/api/pull', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      await fetchData(filters)
    } catch (err) {
      console.error('Pull failed:', err)
      alert(`Pull failed: ${String(err)}`)
    } finally {
      setIsPulling(false)
    }
  }

  function toggleFlow(id: string) {
    setSelectedFlowId((prev) => (prev === id ? null : id))
  }

  // ─── Derived data: filtered + sorted rows ────────────────────────────────

  // All unique tags (excluding EIKONA) for the dropdown
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      for (const t of r.flow.tags ?? []) {
        if (t.toLowerCase() !== 'eikona') set.add(t)
      }
    }
    return Array.from(set).sort()
  }, [rows])

  // Step 1: Exclude EIKONA from dashboard (by tag or name, case-insensitive)
  const nonEikonaRows = useMemo(
    () => rows.filter((r) => {
      const hasEikonaTag = (r.flow.tags ?? []).some((t) => t.toLowerCase() === 'eikona')
      const hasEikonaName = r.flow.name.toLowerCase().includes('eikona')
      return !hasEikonaTag && !hasEikonaName
    }),
    [rows]
  )

  // Step 2: Apply status filter
  const statusFilteredRows = useMemo(() => {
    if (filters.status === 'all') return nonEikonaRows
    return nonEikonaRows.filter((r) => r.flow.status === filters.status)
  }, [nonEikonaRows, filters.status])

  // Step 3: Apply tag filter (multi-select)
  const tagFilteredRows = useMemo(() => {
    if (filters.tags.length === 0) return statusFilteredRows
    if (filters.tags[0] === '__none__') {
      return statusFilteredRows.filter((r) => (r.flow.tags ?? []).length === 0)
    }
    return statusFilteredRows.filter((r) =>
      (r.flow.tags ?? []).some((t) => filters.tags.includes(t))
    )
  }, [statusFilteredRows, filters.tags])

  // Revenue per flow (for sorting alerts by revenue)
  const revenueByFlow = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.flow.flow_id, Number(r.latestSnapshot?.revenue ?? 0))
    }
    return map
  }, [rows])

  function handleAlertActioned(id: number) {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  // Alert breakdown per flow (used for score calculation)
  const alertBreakdownByFlow = useMemo(() => {
    const map = new Map<string, { critical: number; warning: number; info: number }>()
    for (const a of alerts) {
      const existing = map.get(a.flow_id) ?? { critical: 0, warning: 0, info: 0 }
      if (a.severity === 'critical') existing.critical++
      else if (a.severity === 'warning') existing.warning++
      else existing.info++
      map.set(a.flow_id, existing)
    }
    return map
  }, [alerts])

  // Step 4: Apply score filter (needs computed health score including alerts)
  const scoreFilteredRows = useMemo(() => {
    if (filters.score === 'all') return tagFilteredRows
    return tagFilteredRows.filter((r) => {
      const alertData = alertBreakdownByFlow.get(r.flow.flow_id)
      const score = calcHealthScore(
        r.latestSnapshot,
        alertData ? { ...alertData, totalMessages: r.messageCount } : undefined
      )
      switch (filters.score) {
        case 'healthy':  return score >= 80
        case 'fair':     return score >= 60 && score < 80
        case 'poor':     return score >= 40 && score < 60
        case 'critical': return score < 40
        default:         return true
      }
    })
  }, [tagFilteredRows, filters.score, alertBreakdownByFlow])

  // Step 5: Apply sorting
  const filteredRows = useMemo(() => {
    let sorted = [...scoreFilteredRows]

    // Tab-specific sorting overrides
    if (tab === 'performance') {
      sorted.sort((a, b) => (b.latestSnapshot?.open_rate ?? 0) - (a.latestSnapshot?.open_rate ?? 0))
      return sorted
    }
    if (tab === 'deliverability') {
      sorted.sort((a, b) => (b.latestSnapshot?.bounce_rate ?? 0) - (a.latestSnapshot?.bounce_rate ?? 0))
      return sorted
    }

    // Overview: use the sort filter
    if (filters.sortBy === 'revenue') {
      sorted.sort((a, b) => (b.latestSnapshot?.revenue ?? 0) - (a.latestSnapshot?.revenue ?? 0))
    } else if (filters.sortBy === 'recipients') {
      sorted.sort((a, b) => (b.latestSnapshot?.recipients ?? 0) - (a.latestSnapshot?.recipients ?? 0))
    }

    return sorted
  }, [scoreFilteredRows, tab, filters.sortBy])

  // Metric computations (from filtered rows, EIKONA excluded)
  const visibleLiveCount = nonEikonaRows.filter((r) => r.flow.status === 'live').length
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length
  const warningCount  = alerts.filter((a) => a.severity === 'warning').length

  // Alert count per flow (total for badges, plus breakdown by severity for scoring)
  const alertCountByFlow = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of alerts) {
      map.set(a.flow_id, (map.get(a.flow_id) ?? 0) + 1)
    }
    return map
  }, [alerts])

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          title="Dashboard"
          filters={filters}
          onFiltersChange={setFilters}
          tags={allTags}
          onPull={handlePull}
          isPulling={isPulling}
          lastPullTime={lastPullTime}
        />

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <>
              <MetricCards
                totalRevenue={totals?.currentRevenue ?? 0}
                prevRevenue={totals?.prevRevenue}
                flowsMonitored={visibleLiveCount}
                liveFlowCount={totals?.liveFlowCount}
                activeAlerts={alerts.length}
                criticalAlerts={criticalCount}
                warningAlerts={warningCount}
                avgOpenRate={totals?.currentOpenRate ?? 0}
                prevOpenRate={totals?.prevOpenRate}
                compareMode={filters.compareMode}
              />

              {/* Overview tab: alerts + simplified flow list */}
              {tab === 'overview' && (
                <>
                  <AlertsSection alerts={alerts} revenueByFlow={revenueByFlow} onAlertActioned={handleAlertActioned} />
                  <FlowsList
                    rows={filteredRows}
                    onSelectFlow={toggleFlow}
                    selectedFlowId={selectedFlowId}
                    excludeTag="EIKONA"
                    alertCountByFlow={alertCountByFlow}
                    alertBreakdownByFlow={alertBreakdownByFlow}
                  />
                </>
              )}

              {/* Performance tab: alerts for engagement metrics */}
              {tab === 'performance' && (
                <AlertsSection
                  alerts={alerts.filter((a) =>
                    ['open_rate', 'click_rate', 'conversion_rate', 'revenue_drop', 'open_rate_drop', 'click_rate_drop'].includes(a.metric)
                  )}
                  title="Performance alerts"
                  subtitle="Drop in revenue, open rate, click rate, conversion rate"
                  showAll
                  revenueByFlow={revenueByFlow}
                  onAlertActioned={handleAlertActioned}
                />
              )}

              {/* Deliverability tab: alerts for deliverability metrics */}
              {tab === 'deliverability' && (
                <AlertsSection
                  alerts={alerts.filter((a) =>
                    ['spam_complaint_rate', 'unsubscribe_rate', 'bounce_rate'].includes(a.metric)
                  )}
                  title="Deliverability alerts"
                  subtitle="Increased spam rate, unsubscribe rate, bounce rate"
                  showAll
                  revenueByFlow={revenueByFlow}
                  onAlertActioned={handleAlertActioned}
                />
              )}
            </>
          )}
        </div>
      </div>

      {selectedFlowId && (
        <FlowDetailModal
          flowId={selectedFlowId}
          onClose={() => setSelectedFlowId(null)}
          onAlertActioned={handleAlertActioned}
        />
      )}
    </div>
  )
}

// ─── Page wrapper (Suspense required for useSearchParams) ─────────────────────

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingSkeleton fullPage />}>
      <DashboardContent />
    </Suspense>
  )
}

function LoadingSkeleton({ fullPage }: { fullPage?: boolean }) {
  const inner = (
    <div className="animate-pulse space-y-5">
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="h-48 bg-gray-200 rounded-xl" />
      <div className="h-64 bg-gray-200 rounded-xl" />
    </div>
  )
  if (fullPage) {
    return (
      <div className="flex h-screen overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="h-14 bg-white border-b border-gray-200" />
          <div className="flex-1 p-6">{inner}</div>
        </div>
      </div>
    )
  }
  return inner
}
