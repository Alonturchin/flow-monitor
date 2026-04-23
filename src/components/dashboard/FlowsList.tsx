'use client'

import { useState, useMemo } from 'react'
import type { FlowRow } from '@/components/dashboard/FlowsTable'
import { calcHealthScore } from '@/lib/health-score'

interface FlowsListProps {
  rows: FlowRow[]
  onSelectFlow: (id: string) => void
  selectedFlowId?: string | null
  excludeTag?: string
  alertCountByFlow?: Map<string, number>
  alertBreakdownByFlow?: Map<string, { critical: number; warning: number; info: number }>
}

// Deterministic color from tag name string
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
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  }
  return TAG_COLORS[hash % TAG_COLORS.length]
}

function HealthBadge({ score }: { score: number }) {
  const colorClass =
    score >= 75
      ? 'bg-green-100 text-green-700'
      : score >= 50
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}>
      {score}
    </span>
  )
}

export default function FlowsList({
  rows,
  onSelectFlow,
  selectedFlowId,
  excludeTag,
  alertCountByFlow,
  alertBreakdownByFlow,
}: FlowsListProps) {
  const [search, setSearch] = useState('')

  // Filter out EIKONA flows and excludeTag flows
  const visibleRows = useMemo(
    () =>
      rows.filter((r) => {
        const tags = r.flow.tags ?? []
        if (tags.some((t) => t.toLowerCase() === 'eikona')) return false
        if (r.flow.name.toLowerCase().includes('eikona')) return false
        if (excludeTag && tags.some((t) => t.toLowerCase() === excludeTag.toLowerCase())) return false
        return true
      }),
    [rows, excludeTag]
  )

  const filtered = useMemo(() => {
    return visibleRows.filter((r) => {
      const matchesSearch =
        search.trim() === '' ||
        r.flow.name.toLowerCase().includes(search.trim().toLowerCase())
      return matchesSearch
    })
  }, [visibleRows, search])


  return (
    <div>
      {/* Section header */}
      <h2 className="text-base font-semibold text-gray-900 mb-3">All flows</h2>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search flows..."
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Flow rows */}
      <div className="flex flex-col divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden bg-white">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 py-6 text-center">No flows found</p>
        ) : (
          filtered.map((r) => {
            const alertData = alertBreakdownByFlow?.get(r.flow.flow_id)
            const score = calcHealthScore(
              r.latestSnapshot,
              alertData ? { ...alertData, totalMessages: r.messageCount } : undefined
            )
            const isSelected = selectedFlowId === r.flow.flow_id

            return (
              <button
                key={r.flow.flow_id}
                onClick={() => onSelectFlow(r.flow.flow_id)}
                className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50 ${
                  isSelected
                    ? 'border-l-4 border-blue-500 bg-blue-50 hover:bg-blue-50 pl-3'
                    : 'border-l-4 border-transparent'
                }`}
              >
                {/* Name + tags */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.flow.name}</p>
                  {r.flow.tags && r.flow.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.flow.tags.map((tag) => {
                        const [bg, text] = tagColor(tag)
                        return (
                          <span
                            key={tag}
                            className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${bg} ${text}`}
                          >
                            {tag}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Alert badge + Health score */}
                <div className="flex items-center gap-2 shrink-0">
                  {(alertCountByFlow?.get(r.flow.flow_id) ?? 0) > 0 && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">
                      {alertCountByFlow!.get(r.flow.flow_id)}
                    </span>
                  )}
                  <HealthBadge score={score} />
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
