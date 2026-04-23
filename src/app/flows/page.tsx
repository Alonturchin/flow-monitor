'use client'

import { useEffect, useState, useMemo } from 'react'
import FlowsTable, { type FlowRow } from '@/components/dashboard/FlowsTable'
import TopBar from '@/components/layout/TopBar'
import FlowDetailModal from '@/components/flows/FlowDetailModal'

interface ApiResponse {
  rows: FlowRow[]
  lastPullTime: string | null
  totals?: unknown
}

export default function AllFlowsPage() {
  const [rows, setRows] = useState<FlowRow[]>([])
  const [lastPullTime, setLastPullTime] = useState<string | null>(null)
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchFlows() {
    try {
      const res = await fetch('/api/flows')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ApiResponse = await res.json()
      setRows(data.rows ?? [])
      setLastPullTime(data.lastPullTime ?? null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handlePull() {
    setPulling(true)
    try {
      const res = await fetch('/api/pull', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      await fetchFlows()
    } catch (err) {
      console.error('[AllFlowsPage] Pull failed:', err)
    } finally {
      setPulling(false)
    }
  }

  useEffect(() => {
    fetchFlows()
  }, [])

  // Exclude EIKONA flows (by tag or name, case-insensitive)
  const visibleRows = useMemo(() =>
    rows.filter((r) => {
      const hasEikonaTag = (r.flow.tags ?? []).some((t) => t.toLowerCase() === 'eikona')
      const hasEikonaName = r.flow.name.toLowerCase().includes('eikona')
      return !hasEikonaTag && !hasEikonaName
    }),
  [rows])

  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50">
      <TopBar
        title="All Flows"
        lastPullTime={lastPullTime}
        onPull={handlePull}
        isPulling={pulling}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-sm text-gray-400">Loading flows...</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          ) : (
            <FlowsTable
              rows={visibleRows}
              onSelectFlow={setSelectedFlowId}
              selectedFlowId={selectedFlowId}
            />
          )}
        </main>

      </div>

      {/* Detail modal */}
      {selectedFlowId && (
        <FlowDetailModal
          flowId={selectedFlowId}
          onClose={() => setSelectedFlowId(null)}
        />
      )}
    </div>
  )
}
