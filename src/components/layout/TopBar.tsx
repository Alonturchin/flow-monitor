'use client'

import { useState, useRef, useEffect } from 'react'

// ─── Filter types ────────────────────────────────────────────────────────────

export type DateRange = 'last_7d' | 'last_30d' | 'last_90d' | 'mtd' | 'ytd' | 'custom'

export type ScoreFilter = 'all' | 'healthy' | 'fair' | 'poor' | 'critical'

export interface DashboardFilters {
  dateRange: DateRange
  customStart?: string       // ISO date (YYYY-MM-DD), only used when dateRange === 'custom'
  customEnd?: string
  compareMode: 'none' | 'prev_period' | 'prev_year'
  tags: string[]             // empty = all tags
  status: 'all' | 'live' | 'draft'
  score: ScoreFilter
  sortBy: 'revenue' | 'recipients' | null
}

export const DEFAULT_FILTERS: DashboardFilters = {
  dateRange: 'last_30d',
  compareMode: 'none',
  tags: [],
  status: 'all',
  score: 'all',
  sortBy: null,
}

const SCORE_OPTIONS: { key: ScoreFilter; label: string; range: string; color: string }[] = [
  { key: 'all',      label: 'All scores',  range: '0–100', color: 'bg-gray-400' },
  { key: 'healthy',  label: 'Healthy',     range: '80–100', color: 'bg-green-500' },
  { key: 'fair',     label: 'Fair',        range: '60–79', color: 'bg-yellow-400' },
  { key: 'poor',     label: 'Poor',        range: '40–59', color: 'bg-orange-400' },
  { key: 'critical', label: 'Critical',    range: '< 40',  color: 'bg-red-500' },
]

// ─── Props ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  title: string
  subtitle?: string
  // Filter mode (dashboard) — all optional
  filters?: DashboardFilters
  onFiltersChange?: (filters: DashboardFilters) => void
  tags?: string[]
  // Pull
  onPull?: () => void | Promise<void>
  isPulling?: boolean
  lastPullTime?: string | null
}

// ─── Dropdown wrapper ────────────────────────────────────────────────────────

function Dropdown({
  label,
  children,
  isOpen,
  onToggle,
  onClose,
}: {
  label: React.ReactNode
  children: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-700 transition-colors"
      >
        {label}
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[200px]">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Date labels ─────────────────────────────────────────────────────────────

const DATE_LABELS: Record<DateRange, string> = {
  last_7d: 'Last 7 days',
  last_30d: 'Last 30 days',
  last_90d: 'Last 90 days',
  mtd: 'Month to date',
  ytd: 'Year to date',
  custom: 'Custom range',
}

function formatCustomRange(start?: string, end?: string): string {
  if (!start || !end) return 'Custom range'
  const s = new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${s} – ${e}`
}

const COMPARE_LABELS: Record<DashboardFilters['compareMode'], string> = {
  none: 'No comparison',
  prev_period: 'vs Previous period',
  prev_year: 'vs Previous year',
}

// ─── Relative time ───────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TopBar({
  title,
  subtitle,
  filters,
  onFiltersChange,
  tags = [],
  onPull,
  isPulling,
  lastPullTime,
}: TopBarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const hasFilters = !!filters && !!onFiltersChange

  function toggle(name: string) {
    setOpenDropdown((prev) => (prev === name ? null : name))
  }
  function close() {
    setOpenDropdown(null)
  }
  function updateFilter(partial: Partial<DashboardFilters>) {
    if (filters && onFiltersChange) {
      onFiltersChange({ ...filters, ...partial })
    }
    close()
  }

  // Exclude EIKONA from tag list
  const filteredTags = tags.filter((t) => t !== 'EIKONA')

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-3 shrink-0">
      <div className="flex items-center justify-between gap-4">
        {/* Title */}
        <div className="shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>

        {/* Filters */}
        {hasFilters && (
          <div className="flex items-center gap-2 flex-1 justify-center flex-wrap">
            {/* Date range */}
            <Dropdown
              label={
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {filters.dateRange === 'custom'
                    ? formatCustomRange(filters.customStart, filters.customEnd)
                    : DATE_LABELS[filters.dateRange]}
                </span>
              }
              isOpen={openDropdown === 'date'}
              onToggle={() => toggle('date')}
              onClose={close}
            >
              <div className="py-1 min-w-[260px]">
                <p className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Date range</p>
                {(['last_7d', 'last_30d', 'last_90d', 'mtd', 'ytd'] as DateRange[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => updateFilter({ dateRange: key })}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      filters.dateRange === key ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                    }`}
                  >
                    {DATE_LABELS[key]}
                  </button>
                ))}

                {/* Custom range with date inputs */}
                <div className="border-t border-gray-100 mt-1 pt-2">
                  <p className="px-3 pb-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Custom range</p>
                  <div className="px-3 py-1 space-y-1.5">
                    <label className="block">
                      <span className="text-xs text-gray-500">Start</span>
                      <input
                        type="date"
                        value={filters.customStart ?? ''}
                        max={filters.customEnd ?? undefined}
                        onChange={(e) => {
                          onFiltersChange?.({
                            ...filters,
                            dateRange: 'custom',
                            customStart: e.target.value,
                          })
                        }}
                        className="block w-full mt-0.5 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-500">End</span>
                      <input
                        type="date"
                        value={filters.customEnd ?? ''}
                        min={filters.customStart ?? undefined}
                        onChange={(e) => {
                          onFiltersChange?.({
                            ...filters,
                            dateRange: 'custom',
                            customEnd: e.target.value,
                          })
                        }}
                        className="block w-full mt-0.5 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                  </div>
                </div>

                <div className="border-t border-gray-100 my-1" />
                <p className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Compare to</p>
                {(Object.keys(COMPARE_LABELS) as DashboardFilters['compareMode'][]).map((key) => (
                  <button
                    key={key}
                    onClick={() => updateFilter({ compareMode: key })}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      filters.compareMode === key ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                    }`}
                  >
                    {COMPARE_LABELS[key]}
                  </button>
                ))}
              </div>
            </Dropdown>

            {/* Tag filter (multi-select checkboxes) */}
            <Dropdown
              label={
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {filters.tags.length === 0
                    ? 'All tags'
                    : filters.tags.length === 1
                    ? filters.tags[0]
                    : `${filters.tags.length} tags`}
                </span>
              }
              isOpen={openDropdown === 'tag'}
              onToggle={() => toggle('tag')}
              onClose={close}
            >
              <div className="py-1 max-h-72 overflow-y-auto min-w-[220px]">
                {/* Select All / None */}
                <div className="flex gap-2 px-3 py-2 border-b border-gray-100">
                  <button
                    onClick={() => onFiltersChange?.({ ...filters, tags: [] })}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    All
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => onFiltersChange?.({ ...filters, tags: [...filteredTags] })}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Select all
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => onFiltersChange?.({ ...filters, tags: ['__none__'] })}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    None
                  </button>
                </div>
                {filteredTags.map((tag) => {
                  const checked = filters.tags.includes(tag)
                  return (
                    <label
                      key={tag}
                      className="flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? filters.tags.filter((t) => t !== tag)
                            : [...filters.tags.filter((t) => t !== '__none__'), tag]
                          onFiltersChange?.({ ...filters, tags: next })
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                      />
                      <span className={checked ? 'text-gray-900 font-medium' : 'text-gray-700'}>{tag}</span>
                    </label>
                  )
                })}
                {filteredTags.length === 0 && (
                  <p className="px-3 py-2 text-sm text-gray-400">No tags available</p>
                )}
              </div>
            </Dropdown>

            {/* Status filter */}
            <Dropdown
              label={
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {filters.status === 'all' ? 'All statuses' : filters.status === 'live' ? 'Live' : 'Draft'}
                </span>
              }
              isOpen={openDropdown === 'status'}
              onToggle={() => toggle('status')}
              onClose={close}
            >
              <div className="py-1">
                {(['all', 'live', 'draft'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => updateFilter({ status: s })}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                      filters.status === s ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                    }`}
                  >
                    {s === 'live' && <span className="w-2 h-2 rounded-full bg-green-500" />}
                    {s === 'draft' && <span className="w-2 h-2 rounded-full bg-gray-400" />}
                    {s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </Dropdown>

            {/* Score filter */}
            <Dropdown
              label={
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {SCORE_OPTIONS.find((o) => o.key === filters.score)?.label ?? 'All scores'}
                </span>
              }
              isOpen={openDropdown === 'score'}
              onToggle={() => toggle('score')}
              onClose={close}
            >
              <div className="py-1 min-w-[200px]">
                {SCORE_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => updateFilter({ score: o.key })}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                      filters.score === o.key ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${o.color}`} />
                    <span className="flex-1">{o.label}</span>
                    <span className="text-xs text-gray-400">{o.range}</span>
                  </button>
                ))}
              </div>
            </Dropdown>

            {/* Sort by */}
            <Dropdown
              label={
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                  {filters.sortBy === 'revenue' ? 'Revenue' : filters.sortBy === 'recipients' ? 'Recipients' : 'Default sort'}
                </span>
              }
              isOpen={openDropdown === 'sort'}
              onToggle={() => toggle('sort')}
              onClose={close}
            >
              <div className="py-1">
                <button
                  onClick={() => updateFilter({ sortBy: null })}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    filters.sortBy === null ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Default (by name)
                </button>
                <button
                  onClick={() => updateFilter({ sortBy: 'revenue' })}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    filters.sortBy === 'revenue' ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Revenue (high to low)
                </button>
                <button
                  onClick={() => updateFilter({ sortBy: 'recipients' })}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    filters.sortBy === 'recipients' ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Recipients (high to low)
                </button>
              </div>
            </Dropdown>
          </div>
        )}

        {/* Pull button + last pull */}
        <div className="flex items-center gap-3 shrink-0">
          {lastPullTime && !isPulling && (
            <span className="text-xs text-gray-400">
              Pulled {relativeTime(lastPullTime)}
            </span>
          )}
          {onPull && (
            <button
              onClick={() => onPull()}
              disabled={isPulling}
              className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium"
            >
              {isPulling ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Pulling…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Pull data
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Active filter pills */}
      {hasFilters && (filters.tags.length > 0 || filters.compareMode !== 'none' || filters.sortBy || filters.status !== 'all' || filters.score !== 'all') && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {filters.tags.length > 0 && filters.tags[0] !== '__none__' && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
              Tags: {filters.tags.length <= 3 ? filters.tags.join(', ') : `${filters.tags.length} selected`}
              <button onClick={() => onFiltersChange?.({ ...filters, tags: [] })} className="hover:text-blue-900">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {filters.tags[0] === '__none__' && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
              No tags
              <button onClick={() => onFiltersChange?.({ ...filters, tags: [] })} className="hover:text-blue-900">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {filters.status !== 'all' && (
            <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full">
              {filters.status === 'live' ? 'Live' : 'Draft'}
              <button onClick={() => onFiltersChange?.({ ...filters, status: 'all' })} className="hover:text-emerald-900">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {filters.score !== 'all' && (
            <span className="inline-flex items-center gap-1 text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded-full">
              Score: {SCORE_OPTIONS.find((o) => o.key === filters.score)?.label}
              <button onClick={() => onFiltersChange?.({ ...filters, score: 'all' })} className="hover:text-yellow-900">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {filters.compareMode !== 'none' && (
            <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full">
              {COMPARE_LABELS[filters.compareMode]}
              <button onClick={() => updateFilter({ compareMode: 'none' })} className="hover:text-purple-900">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
          {filters.sortBy && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">
              Sort: {filters.sortBy}
              <button onClick={() => updateFilter({ sortBy: null })} className="hover:text-green-900">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
