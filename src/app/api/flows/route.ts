import { NextResponse } from 'next/server'
import {
  getFlowsWithLatestSnapshot,
  getFlowsAggregated,
  getLastPullTime,
  getDashboardTotals,
  getTotalsForRange,
} from '@/lib/queries'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const start   = searchParams.get('start')   // YYYY-MM-DD
    const end     = searchParams.get('end')     // YYYY-MM-DD
    const compare = searchParams.get('compare') ?? 'none'

    // If a date range is provided, aggregate across weeks in that range.
    if (start && end) {
      const [rows, totals, lastPullTime] = await Promise.all([
        getFlowsAggregated(start, end),
        getTotalsForRange(start, end),
        getLastPullTime(),
      ])

      // Compute comparison period if requested
      if (compare === 'prev_period' || compare === 'prev_year') {
        const { prevStart, prevEnd } = computePrevRange(start, end, compare)
        const prev = await getTotalsForRange(prevStart, prevEnd)
        totals.prevRevenue = prev.currentRevenue
        totals.prevOpenRate = prev.currentOpenRate
      }

      return NextResponse.json({ rows, lastPullTime, totals })
    }

    // Default behavior (no dates): latest weekly snapshot
    const [rows, lastPullTime, totals] = await Promise.all([
      getFlowsWithLatestSnapshot(),
      getLastPullTime(),
      getDashboardTotals(),
    ])
    return NextResponse.json({ rows, lastPullTime, totals })
  } catch (err) {
    console.error('[api/flows] Query failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function computePrevRange(start: string, end: string, compare: string): { prevStart: string; prevEnd: string } {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')

  if (compare === 'prev_year') {
    const ps = new Date(s); ps.setUTCFullYear(ps.getUTCFullYear() - 1)
    const pe = new Date(e); pe.setUTCFullYear(pe.getUTCFullYear() - 1)
    return { prevStart: ps.toISOString().slice(0, 10), prevEnd: pe.toISOString().slice(0, 10) }
  }
  // prev_period: same length window, immediately before
  const durationMs = e.getTime() - s.getTime()
  const prevEnd = new Date(s.getTime() - 86_400_000)  // day before start
  const prevStart = new Date(prevEnd.getTime() - durationMs)
  return {
    prevStart: prevStart.toISOString().slice(0, 10),
    prevEnd: prevEnd.toISOString().slice(0, 10),
  }
}
