// Data sync pipeline — fetches Klaviyo data and writes it to Postgres.
// Server-side only. Never import in client components.

import type { PoolClient } from 'pg'
import { withTransaction } from '@/lib/db'
import {
  listFlows,
  listFlowMessages,
  getFlowReport,
  type NormalizedFlow,
} from '@/lib/klaviyo'
import { runAlertEngine } from '@/lib/alert-engine'

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the Sunday 00:00 UTC of the most recently COMPLETED Sun-Sat week.
 * On any day of the week, this goes back to the Sunday that starts a fully-closed 7-day window.
 *
 * Examples:
 *  - Run on Sunday Apr 19 → returns Sun Apr 12 (week Apr 12-18, ended yesterday)
 *  - Run on Monday Apr 20 → returns Sun Apr 12 (week Apr 12-18, ended Saturday)
 *  - Run on Saturday Apr 25 → returns Sun Apr 12 (still the last completed week)
 */
export function getLastWeekStart(): Date {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun … 6=Sat
  // daysBack = days since this week's Sunday + 7 (to go back one full week)
  const daysBack = day + 7
  const d = new Date(now)
  d.setUTCDate(now.getUTCDate() - daysBack)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export function weekEnd(weekStart: Date): Date {
  const d = new Date(weekStart)
  d.setUTCDate(d.getUTCDate() + 7)
  return d
}

// ─── DB upserts ───────────────────────────────────────────────────────────────

async function upsertFlow(client: PoolClient, flow: NormalizedFlow) {
  await client.query(
    `INSERT INTO flows (flow_id, name, tags, status, trigger_type, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (flow_id) DO UPDATE SET
       name         = EXCLUDED.name,
       tags         = EXCLUDED.tags,
       status       = EXCLUDED.status,
       trigger_type = EXCLUDED.trigger_type,
       updated_at   = EXCLUDED.updated_at`,
    [flow.flow_id, flow.name, flow.tags, flow.status, flow.trigger_type, flow.updated_at]
  )
}

interface SnapshotRow {
  flow_id: string
  week_start: string
  recipients: number
  open_rate: number | null
  click_rate: number | null
  unsubscribe_rate: number | null
  spam_complaint_rate: number | null
  bounce_rate: number | null
  revenue: number | null
  revenue_per_recipient: number | null
}

async function upsertFlowSnapshot(client: PoolClient, snap: SnapshotRow) {
  await client.query(
    `INSERT INTO flow_snapshots
       (flow_id, week_start, recipients, open_rate, click_rate, unsubscribe_rate,
        spam_complaint_rate, bounce_rate, revenue, revenue_per_recipient)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (flow_id, week_start) DO UPDATE SET
       recipients          = EXCLUDED.recipients,
       open_rate           = EXCLUDED.open_rate,
       click_rate          = EXCLUDED.click_rate,
       unsubscribe_rate    = EXCLUDED.unsubscribe_rate,
       spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       bounce_rate         = EXCLUDED.bounce_rate,
       revenue             = EXCLUDED.revenue,
       revenue_per_recipient = EXCLUDED.revenue_per_recipient`,
    [
      snap.flow_id, snap.week_start, snap.recipients,
      snap.open_rate, snap.click_rate, snap.unsubscribe_rate,
      snap.spam_complaint_rate, snap.bounce_rate,
      snap.revenue, snap.revenue_per_recipient,
    ]
  )
}

interface MessageSnapshotRow extends SnapshotRow {
  message_id: string
  message_name: string | null
}

async function upsertMessageSnapshot(client: PoolClient, snap: MessageSnapshotRow) {
  await client.query(
    `INSERT INTO message_snapshots
       (flow_id, message_id, message_name, week_start, recipients, open_rate, click_rate,
        unsubscribe_rate, spam_complaint_rate, bounce_rate, revenue, revenue_per_recipient)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (message_id, week_start) DO UPDATE SET
       message_name        = COALESCE(EXCLUDED.message_name, message_snapshots.message_name),
       recipients          = EXCLUDED.recipients,
       open_rate           = EXCLUDED.open_rate,
       click_rate          = EXCLUDED.click_rate,
       unsubscribe_rate    = EXCLUDED.unsubscribe_rate,
       spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       bounce_rate         = EXCLUDED.bounce_rate,
       revenue             = EXCLUDED.revenue,
       revenue_per_recipient = EXCLUDED.revenue_per_recipient`,
    [
      snap.flow_id, snap.message_id, snap.message_name, snap.week_start, snap.recipients,
      snap.open_rate, snap.click_rate, snap.unsubscribe_rate,
      snap.spam_complaint_rate, snap.bounce_rate,
      snap.revenue, snap.revenue_per_recipient,
    ]
  )
}

// ─── Main sync orchestrator ───────────────────────────────────────────────────

export interface SyncResult {
  flows_synced: number
  flow_snapshots_written: number
  message_snapshots_written: number
  alerts_created: number
  alerts_resolved: number
  week_start: string
  duration_ms: number
}

export interface SyncOptions {
  /** If true, skip running the alert engine after this sync (useful for historical backfills). */
  skipAlerts?: boolean
}

export async function runWeeklySync(weekStart?: Date, options: SyncOptions = {}): Promise<SyncResult> {
  const t0 = Date.now()
  const ws = weekStart ?? getLastWeekStart()
  const we = weekEnd(ws)
  const weekStartStr = ws.toISOString().slice(0, 10)

  console.log(`[data-sync] Starting sync for week ${weekStartStr}${options.skipAlerts ? ' (alerts skipped)' : ''}`)

  // 1. Fetch all flows from Klaviyo
  const flows = await listFlows()
  console.log(`[data-sync] ${flows.length} flows fetched`)

  // 2. Fetch flow + message stats via the Reporting API (flow-values-reports)
  //    This single call returns: recipients, opens, clicks, bounces, unsubs,
  //    conversion_value (revenue), and all rates — grouped by flow_message_id.
  const report = await getFlowReport(ws, we)
  console.log(`[data-sync] Report: ${report.flowStats.size} flows, ${report.messageStats.size} messages with stats`)

  // 3. Skip bulk message-name fetching during sync — it's too slow with rate limits.
  //    Names are fetched on-demand when a flow is opened (via /api/flows/:id/messages).
  //    Preserve any existing names already in the DB from previous pulls.
  const messageInfoMap = new Map<string, { message_name: string | null; flow_id: string }>()


  // 4. Write everything in a single transaction
  let flowSnaps = 0
  let msgSnaps = 0
  const knownFlowIds = new Set(flows.map(f => f.flow_id))
  const skippedMsgFlowIds = new Set<string>()

  await withTransaction(async (client) => {
    // Upsert all flows
    for (const flow of flows) {
      await upsertFlow(client, flow)
    }

    // Flow-level snapshots
    for (const flow of flows) {
      const stats = report.flowStats.get(flow.flow_id)
      if (!stats) continue

      await upsertFlowSnapshot(client, {
        flow_id: flow.flow_id,
        week_start: weekStartStr,
        recipients: stats.recipients,
        open_rate: stats.open_rate,
        click_rate: stats.click_rate,
        unsubscribe_rate: stats.unsubscribe_rate,
        spam_complaint_rate: stats.spam_complaint_rate,
        bounce_rate: stats.bounce_rate,
        revenue: stats.revenue || null,
        revenue_per_recipient: stats.revenue_per_recipient,
      })
      flowSnaps++
    }

    // Message-level snapshots
    for (const [msgId, stats] of report.messageStats) {
      const info = messageInfoMap.get(msgId)
      // Use flow_id from the report if we can't find it in messageInfoMap
      const flowId = info?.flow_id ?? stats.flow_id

      // Klaviyo's reporting API can return data for flows that no longer
      // appear in /flows (deleted but historically present). Skip those —
      // their FK to flows would fail.
      if (!knownFlowIds.has(flowId)) {
        skippedMsgFlowIds.add(flowId)
        continue
      }

      await upsertMessageSnapshot(client, {
        flow_id: flowId,
        message_id: msgId,
        message_name: info?.message_name ?? null,
        week_start: weekStartStr,
        recipients: stats.recipients,
        open_rate: stats.open_rate,
        click_rate: stats.click_rate,
        unsubscribe_rate: stats.unsubscribe_rate,
        spam_complaint_rate: stats.spam_complaint_rate,
        bounce_rate: stats.bounce_rate,
        revenue: stats.revenue || null,
        revenue_per_recipient: stats.revenue_per_recipient,
      })
      msgSnaps++
    }
  })

  if (skippedMsgFlowIds.size > 0) {
    console.warn(
      `[data-sync] Skipped messages for ${skippedMsgFlowIds.size} unknown flow_id(s) ` +
      `(deleted in Klaviyo but historically present in report): ` +
      Array.from(skippedMsgFlowIds).join(', ')
    )
  }

  // 5. Run alert engine against the new snapshots (unless skipped)
  const alertResult = options.skipAlerts
    ? { created: 0, resolved: 0 }
    : await runAlertEngine(weekStartStr)

  const result: SyncResult = {
    flows_synced: flows.length,
    flow_snapshots_written: flowSnaps,
    message_snapshots_written: msgSnaps,
    alerts_created: alertResult.created,
    alerts_resolved: alertResult.resolved,
    week_start: weekStartStr,
    duration_ms: Date.now() - t0,
  }

  console.log(`[data-sync] Done in ${result.duration_ms}ms —`, result)
  return result
}
