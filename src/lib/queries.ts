// Database read queries for API routes.
// Server-side only. Never import in client components.

import { query, queryOne } from '@/lib/db'
import type { Flow, FlowSnapshot, MessageSnapshot } from '@/types'
import type { FlowRow } from '@/components/dashboard/FlowsTable'

// ─── Dashboard: flows list with latest snapshot ───────────────────────────────

export async function getFlowsWithLatestSnapshot(): Promise<FlowRow[]> {
  // One query to get all flows + their most recent snapshot via LATERAL join
  const rows = await query<{
    flow_id: string
    name: string
    tags: string[]
    status: string
    trigger_type: string | null
    updated_at: string
    snap_id: string | null
    week_start: string | null
    recipients: string | null
    open_rate: string | null
    click_rate: string | null
    unsubscribe_rate: string | null
    spam_complaint_rate: string | null
    bounce_rate: string | null
    conversion_rate: string | null
    revenue: string | null
    revenue_per_recipient: string | null
    message_count: string
  }>(`
    SELECT
      f.flow_id, f.name, f.tags, f.status, f.trigger_type, f.updated_at,
      s.id::text         AS snap_id,
      s.week_start::text AS week_start,
      s.recipients::text AS recipients,
      s.open_rate::text,
      s.click_rate::text,
      s.unsubscribe_rate::text,
      s.spam_complaint_rate::text,
      s.bounce_rate::text,
      s.conversion_rate::text,
      s.revenue::text,
      s.revenue_per_recipient::text,
      COALESCE((
        SELECT COUNT(DISTINCT message_id)::text
        FROM message_snapshots
        WHERE flow_id = f.flow_id
      ), '0') AS message_count
    FROM flows f
    LEFT JOIN LATERAL (
      SELECT * FROM flow_snapshots
      WHERE flow_id = f.flow_id
      ORDER BY week_start DESC
      LIMIT 1
    ) s ON true
    ORDER BY f.name
  `)

  // Sparkline: last 8 weeks of open_rate per flow (batch query)
  const flowIds = rows.map((r) => r.flow_id)
  const sparklineRows = flowIds.length > 0
    ? await query<{ flow_id: string; open_rate: string | null }>(`
        SELECT flow_id, open_rate::text
        FROM (
          SELECT flow_id, open_rate,
                 ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY week_start DESC) AS rn
          FROM flow_snapshots
          WHERE flow_id = ANY($1)
        ) ranked
        WHERE rn <= 8
        ORDER BY flow_id, rn DESC
      `, [flowIds])
    : []

  // Group sparkline by flow_id
  const sparklineByFlow = new Map<string, number[]>()
  for (const row of sparklineRows) {
    const arr = sparklineByFlow.get(row.flow_id) ?? []
    arr.push(row.open_rate !== null ? Number(row.open_rate) : 0)
    sparklineByFlow.set(row.flow_id, arr)
  }

  return rows.map((row) => ({
    flow: {
      flow_id: row.flow_id,
      name: row.name,
      tags: row.tags ?? [],
      status: row.status as Flow['status'],
      trigger_type: row.trigger_type,
      updated_at: row.updated_at,
    },
    latestSnapshot: row.snap_id
      ? {
          id: Number(row.snap_id),
          flow_id: row.flow_id,
          week_start: row.week_start!,
          recipients: row.recipients !== null ? Number(row.recipients) : 0,
          open_rate: row.open_rate !== null ? Number(row.open_rate) : null,
          click_rate: row.click_rate !== null ? Number(row.click_rate) : null,
          unsubscribe_rate: row.unsubscribe_rate !== null ? Number(row.unsubscribe_rate) : null,
          spam_complaint_rate: row.spam_complaint_rate !== null ? Number(row.spam_complaint_rate) : null,
          bounce_rate: row.bounce_rate !== null ? Number(row.bounce_rate) : null,
          conversion_rate: row.conversion_rate !== null ? Number(row.conversion_rate) : null,
          revenue: row.revenue !== null ? Number(row.revenue) : null,
          revenue_per_recipient: row.revenue_per_recipient !== null ? Number(row.revenue_per_recipient) : null,
          created_at: '',
        }
      : null,
    sparklineData: sparklineByFlow.get(row.flow_id) ?? [],
    messageCount: Number(row.message_count ?? 0),
  }))
}

// ─── Flow detail: flow + latest snapshot + messages ───────────────────────────

export interface FlowDetail {
  flow: Flow
  snapshot: Partial<FlowSnapshot> | null
  prevSnapshot: Partial<FlowSnapshot> | null
  messages: MessageSnapshot[]
}

export async function getFlowDetail(flowId: string): Promise<FlowDetail | null> {
  const flowRow = await queryOne<{
    flow_id: string
    name: string
    tags: string[]
    status: string
    trigger_type: string | null
    updated_at: string
  }>(`SELECT * FROM flows WHERE flow_id = $1`, [flowId])

  if (!flowRow) return null

  const snapRows = await query<Record<string, unknown>>(`
    SELECT * FROM flow_snapshots WHERE flow_id = $1 ORDER BY week_start DESC LIMIT 2
  `, [flowId])
  const snapRow = snapRows[0] ?? null
  const prevSnapRow = snapRows[1] ?? null

  const msgRows = await query<Record<string, unknown>>(`
    SELECT DISTINCT ON (message_id) *
    FROM message_snapshots
    WHERE flow_id = $1
    ORDER BY message_id, week_start DESC
  `, [flowId])

  const toNum = (v: unknown) => (v !== null && v !== undefined ? Number(v) : null)

  const snapshot: Partial<FlowSnapshot> | null = snapRow
    ? {
        id: Number(snapRow.id),
        flow_id: String(snapRow.flow_id),
        week_start: String(snapRow.week_start),
        recipients: Number(snapRow.recipients ?? 0),
        open_rate: toNum(snapRow.open_rate),
        click_rate: toNum(snapRow.click_rate),
        unsubscribe_rate: toNum(snapRow.unsubscribe_rate),
        spam_complaint_rate: toNum(snapRow.spam_complaint_rate),
        bounce_rate: toNum(snapRow.bounce_rate),
        conversion_rate: toNum(snapRow.conversion_rate),
        revenue: toNum(snapRow.revenue),
        revenue_per_recipient: toNum(snapRow.revenue_per_recipient),
        created_at: String(snapRow.created_at ?? ''),
      }
    : null

  const messages: MessageSnapshot[] = msgRows.map((m) => ({
    id: Number(m.id),
    flow_id: String(m.flow_id),
    message_id: String(m.message_id),
    message_name: m.message_name ? String(m.message_name) : null,
    week_start: String(m.week_start),
    recipients: Number(m.recipients ?? 0),
    open_rate: toNum(m.open_rate),
    click_rate: toNum(m.click_rate),
    unsubscribe_rate: toNum(m.unsubscribe_rate),
    spam_complaint_rate: toNum(m.spam_complaint_rate),
    bounce_rate: toNum(m.bounce_rate),
    conversion_rate: toNum(m.conversion_rate),
    revenue: toNum(m.revenue),
    revenue_per_recipient: toNum(m.revenue_per_recipient),
    created_at: String(m.created_at ?? ''),
  }))

  const prevSnapshot: Partial<FlowSnapshot> | null = prevSnapRow
    ? {
        id: Number(prevSnapRow.id),
        flow_id: String(prevSnapRow.flow_id),
        week_start: String(prevSnapRow.week_start),
        recipients: Number(prevSnapRow.recipients ?? 0),
        open_rate: toNum(prevSnapRow.open_rate),
        click_rate: toNum(prevSnapRow.click_rate),
        unsubscribe_rate: toNum(prevSnapRow.unsubscribe_rate),
        spam_complaint_rate: toNum(prevSnapRow.spam_complaint_rate),
        bounce_rate: toNum(prevSnapRow.bounce_rate),
        conversion_rate: toNum(prevSnapRow.conversion_rate),
        revenue: toNum(prevSnapRow.revenue),
        revenue_per_recipient: toNum(prevSnapRow.revenue_per_recipient),
        created_at: String(prevSnapRow.created_at ?? ''),
      }
    : null

  return {
    flow: {
      flow_id: flowRow.flow_id,
      name: flowRow.name,
      tags: flowRow.tags ?? [],
      status: flowRow.status as Flow['status'],
      trigger_type: flowRow.trigger_type,
      updated_at: flowRow.updated_at,
    },
    snapshot,
    prevSnapshot,
    messages,
  }
}

// ─── Last pull time ───────────────────────────────────────────────────────────

export async function getLastPullTime(): Promise<string | null> {
  const row = await queryOne<{ created_at: Date }>(`
    SELECT created_at FROM flow_snapshots ORDER BY created_at DESC LIMIT 1
  `)
  return row?.created_at ? new Date(row.created_at).toISOString() : null
}

// ─── Aggregated flow rows for a date range ──────────────────────────────────

/**
 * Aggregates weekly snapshots within [start, end] into one row per flow.
 * - recipients, revenue: summed
 * - rates: weighted by recipients
 * Date range is inclusive on both ends and uses week_start >= start AND week_start <= end.
 */
export async function getFlowsAggregated(start: string, end: string): Promise<FlowRow[]> {
  const rows = await query<{
    flow_id: string
    name: string
    tags: string[]
    status: string
    trigger_type: string | null
    updated_at: string
    total_recipients: string | null
    total_revenue: string | null
    open_rate: string | null
    click_rate: string | null
    bounce_rate: string | null
    unsubscribe_rate: string | null
    spam_complaint_rate: string | null
    revenue_per_recipient: string | null
    message_count: string
  }>(`
    SELECT
      f.flow_id, f.name, f.tags, f.status, f.trigger_type, f.updated_at,
      agg.total_recipients,
      agg.total_revenue,
      agg.open_rate,
      agg.click_rate,
      agg.bounce_rate,
      agg.unsubscribe_rate,
      agg.spam_complaint_rate,
      agg.revenue_per_recipient,
      COALESCE((
        SELECT COUNT(DISTINCT message_id)::text
        FROM message_snapshots
        WHERE flow_id = f.flow_id
      ), '0') AS message_count
    FROM flows f
    LEFT JOIN LATERAL (
      SELECT
        SUM(recipients)::text AS total_recipients,
        SUM(revenue)::text    AS total_revenue,
        (SUM(open_rate * recipients) / NULLIF(SUM(recipients), 0))::text AS open_rate,
        (SUM(click_rate * recipients) / NULLIF(SUM(recipients), 0))::text AS click_rate,
        (SUM(bounce_rate * recipients) / NULLIF(SUM(recipients), 0))::text AS bounce_rate,
        (SUM(unsubscribe_rate * recipients) / NULLIF(SUM(recipients), 0))::text AS unsubscribe_rate,
        (SUM(spam_complaint_rate * recipients) / NULLIF(SUM(recipients), 0))::text AS spam_complaint_rate,
        (SUM(revenue) / NULLIF(SUM(recipients), 0))::text AS revenue_per_recipient
      FROM flow_snapshots
      WHERE flow_id = f.flow_id
        AND week_start >= $1::date
        AND week_start <= $2::date
    ) agg ON true
    ORDER BY f.name
  `, [start, end])

  return rows.map((row) => ({
    flow: {
      flow_id: row.flow_id,
      name: row.name,
      tags: row.tags ?? [],
      status: row.status as Flow['status'],
      trigger_type: row.trigger_type,
      updated_at: row.updated_at,
    },
    latestSnapshot: row.total_recipients !== null
      ? {
          id: 0,
          flow_id: row.flow_id,
          week_start: start,
          recipients: Number(row.total_recipients ?? 0),
          open_rate:        row.open_rate        !== null ? Number(row.open_rate) : null,
          click_rate:       row.click_rate       !== null ? Number(row.click_rate) : null,
          bounce_rate:      row.bounce_rate      !== null ? Number(row.bounce_rate) : null,
          unsubscribe_rate: row.unsubscribe_rate !== null ? Number(row.unsubscribe_rate) : null,
          spam_complaint_rate: row.spam_complaint_rate !== null ? Number(row.spam_complaint_rate) : null,
          conversion_rate: null,
          revenue:          row.total_revenue !== null ? Number(row.total_revenue) : null,
          revenue_per_recipient: row.revenue_per_recipient !== null ? Number(row.revenue_per_recipient) : null,
          created_at: '',
        }
      : null,
    sparklineData: [],
    messageCount: Number(row.message_count ?? 0),
  }))
}

export async function getTotalsForRange(start: string, end: string): Promise<DashboardTotals> {
  const row = await queryOne<{
    total_revenue: string | null
    avg_open_rate: string | null
    live_flow_count: string
  }>(`
    SELECT
      COALESCE(SUM(revenue), 0)::text AS total_revenue,
      (SUM(open_rate * recipients) / NULLIF(SUM(recipients), 0))::text AS avg_open_rate,
      (SELECT COUNT(*)::text FROM flows WHERE status = 'live') AS live_flow_count
    FROM flow_snapshots
    WHERE week_start >= $1::date AND week_start <= $2::date
  `, [start, end])

  return {
    currentRevenue:  Number(row?.total_revenue ?? 0),
    prevRevenue:     0,
    currentOpenRate: Number(row?.avg_open_rate ?? 0),
    prevOpenRate:    0,
    liveFlowCount:   Number(row?.live_flow_count ?? 0),
  }
}

// ─── Dashboard totals ─────────────────────────────────────────────────────────

export interface DashboardTotals {
  currentRevenue: number
  prevRevenue: number
  currentOpenRate: number
  prevOpenRate: number
  liveFlowCount: number
}

export async function getDashboardTotals(): Promise<DashboardTotals> {
  const row = await queryOne<{
    cur_revenue: string | null
    prev_revenue: string | null
    cur_open_rate: string | null
    prev_open_rate: string | null
    live_flow_count: string
  }>(`
    WITH ranked AS (
      SELECT flow_id, revenue, open_rate,
             ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY week_start DESC) AS rn
      FROM flow_snapshots
    )
    SELECT
      COALESCE(SUM(CASE WHEN rn = 1 THEN revenue END), 0)::text    AS cur_revenue,
      COALESCE(SUM(CASE WHEN rn = 2 THEN revenue END), 0)::text    AS prev_revenue,
      COALESCE(AVG(CASE WHEN rn = 1 THEN open_rate END), 0)::text  AS cur_open_rate,
      COALESCE(AVG(CASE WHEN rn = 2 THEN open_rate END), 0)::text  AS prev_open_rate,
      (SELECT COUNT(*)::text FROM flows WHERE status = 'live')     AS live_flow_count
    FROM ranked
    WHERE rn <= 2
  `)

  return {
    currentRevenue:  Number(row?.cur_revenue  ?? 0),
    prevRevenue:     Number(row?.prev_revenue  ?? 0),
    currentOpenRate: Number(row?.cur_open_rate ?? 0),
    prevOpenRate:    Number(row?.prev_open_rate ?? 0),
    liveFlowCount:   Number(row?.live_flow_count ?? 0),
  }
}
