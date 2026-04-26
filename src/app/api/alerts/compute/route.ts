import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getThresholds } from '@/lib/alert-engine'

/**
 * GET /api/alerts/compute?flow_id=X&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Computes synthetic (view-only) alerts for the given flow across the
 * specified date range, comparing it to the immediately prior same-length window.
 * Does NOT touch the alerts table — these alerts are ephemeral.
 *
 * Returns: { alerts: ComputedAlert[], meta: {...} }
 */

export interface ComputedAlert {
  id: string              // synthetic: "computed-<metric>-<flow/msg>-..."
  flow_id: string
  flow_name: string
  message_id: string | null
  message_name: string | null
  metric: string          // revenue_drop, open_rate_drop, click_rate_drop
  severity: 'critical' | 'warning'
  value: number           // drop percentage (0-1)
  threshold: number
  ai_suggestion: string
  computed: true
  cur_value: number       // raw current-period metric value
  prev_value: number      // raw prior-period metric value
  cur_recipients: number
  prev_recipients: number
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const flow_id = searchParams.get('flow_id')
    const start   = searchParams.get('start')   // YYYY-MM-DD
    const end     = searchParams.get('end')     // YYYY-MM-DD

    if (!flow_id || !start || !end) {
      return NextResponse.json({ error: 'flow_id, start, end required' }, { status: 400 })
    }

    // Compute prior period (same length window immediately before)
    const sD = new Date(start + 'T00:00:00Z')
    const eD = new Date(end + 'T00:00:00Z')
    const durationMs = eD.getTime() - sD.getTime()
    const prevEnd = new Date(sD.getTime() - 86_400_000)
    const prevStart = new Date(prevEnd.getTime() - durationMs)
    const prevStartStr = prevStart.toISOString().slice(0, 10)
    const prevEndStr   = prevEnd.toISOString().slice(0, 10)

    const thresholds = await getThresholds()

    // Flow name
    const flowRow = await query<{ name: string }>(
      `SELECT name FROM flows WHERE flow_id = $1`,
      [flow_id]
    )
    const flowName = flowRow[0]?.name ?? flow_id

    // ── Aggregate flow-level for both windows ──
    const flowAgg = await query<{
      cur_revenue: string | null
      prev_revenue: string | null
      cur_recipients: string | null
      prev_recipients: string | null
      cur_open: string | null
      prev_open: string | null
      cur_click: string | null
      prev_click: string | null
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN revenue END), 0)::text    AS cur_revenue,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN revenue END), 0)::text    AS prev_revenue,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN recipients END), 0)::text AS cur_recipients,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN recipients END), 0)::text AS prev_recipients,
        (SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN open_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN recipients END), 0))::text AS cur_open,
        (SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN open_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN recipients END), 0))::text AS prev_open,
        (SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN click_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN recipients END), 0))::text AS cur_click,
        (SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN click_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN recipients END), 0))::text AS prev_click
      FROM flow_snapshots
      WHERE flow_id = $1
    `, [flow_id, start, end, prevStartStr, prevEndStr])

    // ── Per-message aggregation ──
    const msgAgg = await query<{
      message_id: string
      message_name: string | null
      cur_revenue: string | null
      prev_revenue: string | null
      cur_recipients: string | null
      prev_recipients: string | null
      cur_open: string | null
      prev_open: string | null
      cur_click: string | null
      prev_click: string | null
    }>(`
      SELECT
        message_id,
        MAX(message_name) AS message_name,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN revenue END), 0)::text    AS cur_revenue,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN revenue END), 0)::text    AS prev_revenue,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN recipients END), 0)::text AS cur_recipients,
        COALESCE(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN recipients END), 0)::text AS prev_recipients,
        (SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN open_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN recipients END), 0))::text AS cur_open,
        (SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN open_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN recipients END), 0))::text AS prev_open,
        (SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN click_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $2::date AND $3::date THEN recipients END), 0))::text AS cur_click,
        (SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN click_rate * recipients END)
          / NULLIF(SUM(CASE WHEN week_start BETWEEN $4::date AND $5::date THEN recipients END), 0))::text AS prev_click
      FROM message_snapshots
      WHERE flow_id = $1
      GROUP BY message_id
    `, [flow_id, start, end, prevStartStr, prevEndStr])

    const alerts: ComputedAlert[] = []

    const pushDrop = (args: {
      scope: 'flow' | 'message'
      message_id: string | null
      message_name: string | null
      metric: 'revenue_drop' | 'open_rate_drop' | 'click_rate_drop'
      curVal: number
      prevVal: number
      curRecip: number
      prevRecip: number
    }) => {
      const { scope, message_id, message_name, metric, curVal, prevVal, curRecip, prevRecip } = args

      // Common recipient gate
      if (curRecip < thresholds.min_recipients) return
      if (prevRecip < thresholds.min_recipients) return
      if (prevVal <= 0) return
      if (curVal >= prevVal) return

      // Metric-specific thresholds
      let warnT: number, critT: number
      if (metric === 'revenue_drop') {
        if (prevVal < thresholds.revenue_drop_min) return
        warnT = thresholds.revenue_drop_warning
        critT = thresholds.revenue_drop_critical
      } else if (metric === 'open_rate_drop') {
        warnT = thresholds.open_drop_warning
        critT = thresholds.open_drop_critical
      } else {
        warnT = thresholds.click_drop_warning
        critT = thresholds.click_drop_critical
      }

      const dropPct = (prevVal - curVal) / prevVal
      if (dropPct < warnT) return

      const severity: 'critical' | 'warning' = dropPct >= critT ? 'critical' : 'warning'
      const threshold = severity === 'critical' ? critT : warnT

      const suggestions: Record<string, string> = {
        revenue_drop: 'Revenue dropped period-over-period. Check: recipient count changes, segment health, whether a promo ended, deliverability issues, or flow logic changes.',
        open_rate_drop: 'Open rate dropped period-over-period. Check: subject line changes, sender reputation, inbox placement (spam folder?), or audience segment changes.',
        click_rate_drop: 'Click rate dropped period-over-period. Check: CTA changes, content relevance, email layout/rendering, or whether link destinations changed.',
      }

      let detail = ''
      if (metric === 'revenue_drop') {
        detail = `Revenue fell from $${prevVal.toFixed(0)} to $${curVal.toFixed(0)} (${Math.round(dropPct * 100)}% drop).\nAI suggestion: ${suggestions[metric]}`
      } else {
        const label = metric === 'open_rate_drop' ? 'Open rate' : 'Click rate'
        detail = `${label} fell from ${(prevVal * 100).toFixed(1)}% to ${(curVal * 100).toFixed(1)}% (${Math.round(dropPct * 100)}% drop).\nAI suggestion: ${suggestions[metric]}`
      }

      alerts.push({
        id: `computed-${metric}-${scope}-${message_id ?? flow_id}`,
        flow_id,
        flow_name: flowName,
        message_id,
        message_name,
        metric,
        severity,
        value: dropPct,
        threshold,
        ai_suggestion: detail,
        computed: true,
        cur_value: curVal,
        prev_value: prevVal,
        cur_recipients: curRecip,
        prev_recipients: prevRecip,
      })
    }

    // Flow-level checks (only used if no message-level drops for the same metric)
    const flowRow2 = flowAgg[0]
    const msgFlowMetricKeys = new Set<string>()

    // Message-level checks first
    for (const m of msgAgg) {
      const curRecip = Number(m.cur_recipients ?? 0)
      const prevRecip = Number(m.prev_recipients ?? 0)
      const msgInfo = { scope: 'message' as const, message_id: m.message_id, message_name: m.message_name }

      // Revenue
      const before = alerts.length
      pushDrop({ ...msgInfo, metric: 'revenue_drop',
        curVal: Number(m.cur_revenue ?? 0), prevVal: Number(m.prev_revenue ?? 0),
        curRecip, prevRecip })
      if (alerts.length > before) msgFlowMetricKeys.add('revenue_drop')

      const before2 = alerts.length
      pushDrop({ ...msgInfo, metric: 'open_rate_drop',
        curVal: Number(m.cur_open ?? 0), prevVal: Number(m.prev_open ?? 0),
        curRecip, prevRecip })
      if (alerts.length > before2) msgFlowMetricKeys.add('open_rate_drop')

      const before3 = alerts.length
      pushDrop({ ...msgInfo, metric: 'click_rate_drop',
        curVal: Number(m.cur_click ?? 0), prevVal: Number(m.prev_click ?? 0),
        curRecip, prevRecip })
      if (alerts.length > before3) msgFlowMetricKeys.add('click_rate_drop')
    }

    // Flow-level fallback
    if (flowRow2) {
      const curRecip = Number(flowRow2.cur_recipients ?? 0)
      const prevRecip = Number(flowRow2.prev_recipients ?? 0)
      const flowInfo = { scope: 'flow' as const, message_id: null, message_name: null }

      if (!msgFlowMetricKeys.has('revenue_drop')) {
        pushDrop({ ...flowInfo, metric: 'revenue_drop',
          curVal: Number(flowRow2.cur_revenue ?? 0), prevVal: Number(flowRow2.prev_revenue ?? 0),
          curRecip, prevRecip })
      }
      if (!msgFlowMetricKeys.has('open_rate_drop')) {
        pushDrop({ ...flowInfo, metric: 'open_rate_drop',
          curVal: Number(flowRow2.cur_open ?? 0), prevVal: Number(flowRow2.prev_open ?? 0),
          curRecip, prevRecip })
      }
      if (!msgFlowMetricKeys.has('click_rate_drop')) {
        pushDrop({ ...flowInfo, metric: 'click_rate_drop',
          curVal: Number(flowRow2.cur_click ?? 0), prevVal: Number(flowRow2.prev_click ?? 0),
          curRecip, prevRecip })
      }
    }

    // Sort: critical first, then warning
    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
      return b.value - a.value
    })

    return NextResponse.json({
      alerts,
      meta: {
        start, end,
        prev_start: prevStartStr, prev_end: prevEndStr,
      },
    })
  } catch (err) {
    console.error('[api/alerts/compute]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
