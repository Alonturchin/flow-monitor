// Helper to compute start/end dates from a DashboardFilters date range setting
// Client-safe: no server imports, no secrets.

export type DateRange = 'last_7d' | 'last_30d' | 'last_90d' | 'mtd' | 'ytd' | 'custom'

export interface DateRangeInput {
  dateRange: DateRange
  customStart?: string
  customEnd?: string
}

export interface DateRangeResult {
  start: Date
  end: Date
  /** Previous period with the same length (for "vs previous period" comparisons) */
  prevStart: Date
  prevEnd: Date
  /** Same range one year earlier */
  prevYearStart: Date
  prevYearEnd: Date
}

export function computeDateRange(filter: DateRangeInput): DateRangeResult {
  const now = new Date()
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  let start: Date

  switch (filter.dateRange) {
    case 'last_7d':
      start = new Date(now)
      start.setDate(start.getDate() - 7)
      break
    case 'last_30d':
      start = new Date(now)
      start.setDate(start.getDate() - 30)
      break
    case 'last_90d':
      start = new Date(now)
      start.setDate(start.getDate() - 90)
      break
    case 'mtd':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'ytd':
      start = new Date(now.getFullYear(), 0, 1)
      break
    case 'custom':
      start = filter.customStart
        ? new Date(filter.customStart + 'T00:00:00')
        : new Date(now.getFullYear(), now.getMonth(), 1)
      const customEnd = filter.customEnd
        ? new Date(filter.customEnd + 'T23:59:59')
        : end
      return withComparisons(start, customEnd)
  }

  start.setHours(0, 0, 0, 0)
  return withComparisons(start, end)
}

function withComparisons(start: Date, end: Date): DateRangeResult {
  const durationMs = end.getTime() - start.getTime()

  // Previous period: same length, immediately before
  const prevEnd = new Date(start.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - durationMs)

  // Same range 1 year ago
  const prevYearStart = new Date(start)
  prevYearStart.setFullYear(prevYearStart.getFullYear() - 1)
  const prevYearEnd = new Date(end)
  prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1)

  return { start, end, prevStart, prevEnd, prevYearStart, prevYearEnd }
}
