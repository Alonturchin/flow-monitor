'use client'

import { useState } from 'react'
import Sparkline from './Sparkline'
import { calcHealthScore, healthLabel } from '@/lib/health-score'
import type { Flow, FlowSnapshot } from '@/types'

export interface FlowRow {
  flow: Flow
  latestSnapshot: Partial<FlowSnapshot> | null
  sparklineData: number[]   // 8 weeks of open_rate
  messageCount?: number     // total emails in flow
}

interface FlowsTableProps {
  rows: FlowRow[]
  onSelectFlow: (flowId: string) => void
  selectedFlowId?: string | null
  isEmpty?: boolean  // true when no data has been pulled yet
}

type SortKey = 'name' | 'health' | 'recipients' | 'open_rate' | 'click_rate' | 'revenue'

const HEALTH_COLOR: Record<string, string> = {
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    live: 'bg-green-50 text-green-700 border border-green-200',
    draft: 'bg-gray-100 text-gray-500',
    archived: 'bg-gray-100 text-gray-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.draft}`}>
      {status}
    </span>
  )
}

function fmt(n: number | null | undefined, isPercent = false) {
  if (n == null) return '—'
  if (isPercent) return `${(n * 100).toFixed(1)}%`
  return n.toLocaleString()
}

function fmtRevenue(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

export default function FlowsTable({ rows, onSelectFlow, selectedFlowId, isEmpty }: FlowsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('health')
  const [sortAsc, setSortAsc] = useState(false)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')

  const allTags = Array.from(new Set(rows.flatMap((r) => r.flow.tags ?? [])))

  const sorted = [...rows]
    .filter((r) => {
      const matchSearch = r.flow.name.toLowerCase().includes(search.toLowerCase())
      const matchTag = !tagFilter || r.flow.tags?.includes(tagFilter)
      return matchSearch && matchTag
    })
    .sort((a, b) => {
      const scoreA = calcHealthScore(a.latestSnapshot ?? {})
      const scoreB = calcHealthScore(b.latestSnapshot ?? {})
      let diff = 0
      switch (sortKey) {
        case 'name': diff = a.flow.name.localeCompare(b.flow.name); break
        case 'health': diff = scoreA - scoreB; break
        case 'recipients': diff = (a.latestSnapshot?.recipients ?? 0) - (b.latestSnapshot?.recipients ?? 0); break
        case 'open_rate': diff = (a.latestSnapshot?.open_rate ?? 0) - (b.latestSnapshot?.open_rate ?? 0); break
        case 'click_rate': diff = (a.latestSnapshot?.click_rate ?? 0) - (b.latestSnapshot?.click_rate ?? 0); break
        case 'revenue': diff = (a.latestSnapshot?.revenue ?? 0) - (b.latestSnapshot?.revenue ?? 0); break
      }
      return sortAsc ? diff : -diff
    })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  function SortHeader({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col
    return (
      <th
        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
        onClick={() => toggleSort(col)}
      >
        {label} {active ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Filters */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search flows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <span className="ml-auto text-xs text-gray-400">{sorted.length} flows</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <SortHeader label="Flow Name" col="name" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tag</th>
              <SortHeader label="Health" col="health" />
              <SortHeader label="Recipients" col="recipients" />
              <SortHeader label="Open Rate" col="open_rate" />
              <SortHeader label="Click Rate" col="click_rate" />
              <SortHeader label="Revenue" col="revenue" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">8 Weeks</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">
                  {isEmpty
                    ? 'No data yet — click "Pull now" to fetch Klaviyo flows'
                    : 'No flows match your search'}
                </td>
              </tr>
            )}
            {sorted.map(({ flow, latestSnapshot, sparklineData }) => {
              const score = calcHealthScore(latestSnapshot ?? {})
              const { label, color } = healthLabel(score)
              const isSelected = selectedFlowId === flow.flow_id

              return (
                <tr
                  key={flow.flow_id}
                  onClick={() => onSelectFlow(flow.flow_id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">
                    {flow.name}
                  </td>
                  <td className="px-4 py-3">
                    {flow.tags?.[0] ? (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {flow.tags[0]}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${HEALTH_COLOR[color]}`}>
                      {score} · {label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{fmt(latestSnapshot?.recipients)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmt(latestSnapshot?.open_rate, true)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmt(latestSnapshot?.click_rate, true)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtRevenue(latestSnapshot?.revenue)}</td>
                  <td className="px-4 py-3">
                    <Sparkline data={sparklineData} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={flow.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
