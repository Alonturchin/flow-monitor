import { NextResponse } from 'next/server'
import { getFlowReport, listFlows } from '@/lib/klaviyo'
import type { FlowRow } from '@/components/dashboard/FlowsTable'
import type { DashboardTotals } from '@/lib/queries'
import { getFlowsWithLatestSnapshot, getDashboardTotals } from '@/lib/queries'

// In-memory cache to avoid hammering Klaviyo's rate limit (2/min)
interface CacheEntry {
  data: { rows: FlowRow[]; totals: DashboardTotals }
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const startParam = searchParams.get('start')
    const endParam   = searchParams.get('end')
    const compare    = searchParams.get('compare') ?? 'none'  // 'none' | 'prev_period' | 'prev_year'

    if (!startParam || !endParam) {
      return NextResponse.json({ error: 'start and end required' }, { status: 400 })
    }

    const start = new Date(startParam)
    const end   = new Date(endParam)

    // Cache key
    const cacheKey = `${startParam}|${endParam}|${compare}`
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data)
    }

    // Compute comparison window
    let prevStart: Date | null = null
    let prevEnd: Date | null = null
    if (compare === 'prev_period') {
      const durationMs = end.getTime() - start.getTime()
      prevEnd = new Date(start.getTime() - 1)
      prevStart = new Date(prevEnd.getTime() - durationMs)
    } else if (compare === 'prev_year') {
      prevStart = new Date(start)
      prevStart.setFullYear(prevStart.getFullYear() - 1)
      prevEnd = new Date(end)
      prevEnd.setFullYear(prevEnd.getFullYear() - 1)
    }

    // Fetch current + (optional) previous period in parallel
    const [flows, report, prevReport] = await Promise.all([
      listFlows(),
      getFlowReport(start, end),
      prevStart && prevEnd ? getFlowReport(prevStart, prevEnd) : Promise.resolve(null),
    ])

    // Build flow rows
    const rows: FlowRow[] = flows.map((flow) => {
      const stats = report.flowStats.get(flow.flow_id)
      return {
        flow: {
          flow_id: flow.flow_id,
          name: flow.name,
          tags: flow.tags ?? [],
          status: flow.status,
          trigger_type: flow.trigger_type ?? null,
          updated_at: flow.updated_at,
        },
        latestSnapshot: stats
          ? {
              id: 0,
              flow_id: flow.flow_id,
              week_start: start.toISOString().slice(0, 10),
              recipients: stats.recipients,
              open_rate: stats.open_rate,
              click_rate: stats.click_rate,
              unsubscribe_rate: stats.unsubscribe_rate,
              spam_complaint_rate: null,
              bounce_rate: stats.bounce_rate,
              conversion_rate: null,
              revenue: stats.revenue,
              revenue_per_recipient: stats.revenue_per_recipient,
              created_at: '',
            }
          : null,
        sparklineData: [],
      }
    })

    // Compute totals (exclude EIKONA)
    const nonEikona = rows.filter(
      (r) =>
        !(r.flow.tags ?? []).some((t) => t.toLowerCase() === 'eikona') &&
        !r.flow.name.toLowerCase().includes('eikona')
    )

    const currentRevenue = Array.from(report.flowStats.values())
      .filter((s) => {
        const f = flows.find((f) => f.flow_id === s.flow_id)
        if (!f) return false
        return !(f.tags ?? []).some((t) => t.toLowerCase() === 'eikona') &&
               !f.name.toLowerCase().includes('eikona')
      })
      .reduce((sum, s) => sum + (s.revenue ?? 0), 0)

    // Weighted average open rate (by recipients)
    const nonEikonaStats = Array.from(report.flowStats.values()).filter((s) => {
      const f = flows.find((f) => f.flow_id === s.flow_id)
      if (!f) return false
      return !(f.tags ?? []).some((t) => t.toLowerCase() === 'eikona') &&
             !f.name.toLowerCase().includes('eikona')
    })
    const totalRecipients = nonEikonaStats.reduce((sum, s) => sum + (s.recipients ?? 0), 0)
    const totalOpens = nonEikonaStats.reduce((sum, s) => sum + (s.opens ?? 0), 0)
    const currentOpenRate = totalRecipients > 0 ? totalOpens / totalRecipients : 0

    // Prev period totals (if any)
    let prevRevenue = 0
    let prevOpenRate = 0
    if (prevReport) {
      const prevStats = Array.from(prevReport.flowStats.values()).filter((s) => {
        const f = flows.find((f) => f.flow_id === s.flow_id)
        if (!f) return false
        return !(f.tags ?? []).some((t) => t.toLowerCase() === 'eikona') &&
               !f.name.toLowerCase().includes('eikona')
      })
      prevRevenue = prevStats.reduce((sum, s) => sum + (s.revenue ?? 0), 0)
      const prevRecip = prevStats.reduce((sum, s) => sum + (s.recipients ?? 0), 0)
      const prevOpens = prevStats.reduce((sum, s) => sum + (s.opens ?? 0), 0)
      prevOpenRate = prevRecip > 0 ? prevOpens / prevRecip : 0
    }

    const liveFlowCount = flows.filter((f) => f.status === 'live').length

    const totals: DashboardTotals = {
      currentRevenue,
      prevRevenue,
      currentOpenRate,
      prevOpenRate,
      liveFlowCount,
    }

    const response = { rows, totals }
    cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS })
    return NextResponse.json(response)
  } catch (err) {
    const errStr = String(err)
    console.error('[api/flows/range] Failed:', errStr)

    // On rate limit or any error, fall back to DB data (last pull)
    if (errStr.includes('429') || errStr.includes('throttled')) {
      console.log('[api/flows/range] Rate limited, falling back to DB')
      try {
        const [rows, totals] = await Promise.all([
          getFlowsWithLatestSnapshot(),
          getDashboardTotals(),
        ])
        return NextResponse.json({ rows, totals, _fallback: 'db' })
      } catch (dbErr) {
        console.error('[api/flows/range] DB fallback failed:', dbErr)
      }
    }

    return NextResponse.json({ error: errStr }, { status: 500 })
  }
}
