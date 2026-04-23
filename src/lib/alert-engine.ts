// Alert engine — runs after each data sync.
// Detects threshold crossings and upserts alerts. Auto-resolves cleared metrics.
// Server-side only.

import type { PoolClient } from 'pg'
import { query, queryOne, withTransaction } from '@/lib/db'
import type { FlowSnapshot, AlertSeverity } from '@/types'
import { type AlertThresholds, DEFAULT_THRESHOLDS } from '@/lib/alert-thresholds'

export type { AlertThresholds }
export { DEFAULT_THRESHOLDS }

// ─── Threshold rules ──────────────────────────────────────────────────────────

interface ThresholdRule {
  metric: keyof Pick<FlowSnapshot,
    'spam_complaint_rate' | 'bounce_rate' | 'unsubscribe_rate' | 'open_rate' | 'click_rate'>
  direction: 'above' | 'below'
  threshold: number
  severity: AlertSeverity
  minRecipients?: number
}

export async function getThresholds(): Promise<AlertThresholds> {
  try {
    const row = await queryOne<{ value: Partial<AlertThresholds> }>(
      `SELECT value FROM app_settings WHERE key = 'alert_thresholds'`
    )
    return row ? { ...DEFAULT_THRESHOLDS, ...row.value } : DEFAULT_THRESHOLDS
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

function buildRules(t: AlertThresholds): ThresholdRule[] {
  // min_recipients applies to ALL rules — no alerts fire on flows/messages below this volume.
  const min = t.min_recipients
  return [
    { metric: 'spam_complaint_rate', direction: 'above', threshold: t.spam_critical,   severity: 'critical', minRecipients: min },
    { metric: 'spam_complaint_rate', direction: 'above', threshold: t.spam_warning,    severity: 'warning',  minRecipients: min },
    { metric: 'bounce_rate',         direction: 'above', threshold: t.bounce_critical, severity: 'critical', minRecipients: min },
    { metric: 'bounce_rate',         direction: 'above', threshold: t.bounce_warning,  severity: 'warning',  minRecipients: min },
    { metric: 'unsubscribe_rate',    direction: 'above', threshold: t.unsub_warning,   severity: 'warning',  minRecipients: min },
    { metric: 'unsubscribe_rate',    direction: 'above', threshold: t.unsub_info,      severity: 'info',     minRecipients: min },
    // Open rate: absolute threshold = "too low in general"
    { metric: 'open_rate',           direction: 'below', threshold: t.open_critical,   severity: 'critical', minRecipients: min },
    { metric: 'open_rate',           direction: 'below', threshold: t.open_info,       severity: 'info',     minRecipients: min },
    // Click rate: no absolute threshold — use drop detection instead (see Pass 4)
  ]
}

function isTriggered(snap: Partial<FlowSnapshot>, rule: ThresholdRule): boolean {
  const value = snap[rule.metric]
  if (value == null) return false
  if (rule.minRecipients && (snap.recipients ?? 0) < rule.minRecipients) return false
  if (rule.direction === 'above') return Number(value) > rule.threshold
  return Number(value) < rule.threshold
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getUnresolvedAlert(
  client: PoolClient,
  flowId: string,
  metric: string,
  threshold: number
): Promise<{ id: number } | null> {
  const rows = await client.query<{ id: number }>(
    `SELECT id FROM alerts
     WHERE flow_id = $1 AND metric = $2 AND threshold = $3 AND resolved_at IS NULL
     LIMIT 1`,
    [flowId, metric, threshold]
  )
  return rows.rows[0] ?? null
}

async function createAlert(
  client: PoolClient,
  flowId: string,
  metric: string,
  value: number,
  threshold: number,
  severity: AlertSeverity,
  aiSuggestion: string | null = null,
  weekStart: string | null = null
): Promise<void> {
  await client.query(
    `INSERT INTO alerts (flow_id, metric, value, threshold, severity, ai_suggestion, week_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [flowId, metric, value, threshold, severity, aiSuggestion, weekStart]
  )
}

// ─── Message detail + AI suggestion builder ──────────────────────────────────

const SUGGESTION_TEMPLATES: Record<string, string> = {
  bounce_rate:         'Review email list hygiene. Remove hard-bounced addresses and check if recent list imports contain outdated data.',
  spam_complaint_rate: 'A/B test subject line and check if the list source changed — simultaneous spam + unsub spikes often signal audience mismatch.',
  unsubscribe_rate:    'Review email frequency and content relevance. Consider segmenting by engagement level or adding a preference center.',
  open_rate:           'A/B test subject lines and preview text. Check sender reputation and review send timing for this audience segment.',
  click_rate:          'Improve CTA placement and copy. Check that emails render correctly across devices and that links are prominent.',
  revenue_drop:        'Revenue dropped sharply week-over-week. Check: recipient count changes, segment health, whether a promo ended, deliverability issues, or flow logic changes.',
  open_rate_drop:      'Open rate dropped sharply week-over-week. Check: subject line changes, sender reputation, inbox placement (spam folder?), or audience segment changes.',
  click_rate_drop:     'Click rate dropped sharply week-over-week. Check: CTA changes, content relevance, email layout/rendering, or whether link destinations changed.',
}

async function buildAlertDetail(
  client: PoolClient,
  flowId: string,
  metric: string,
  threshold: number,
  direction: 'above' | 'below',
  weekStart: string
): Promise<string | null> {
  // Find affected messages in this flow
  const metricCol = metric // column name matches
  const msgRows = await client.query<{
    message_name: string | null
    message_id: string
    value: number
  }>(`
    SELECT message_name, message_id, ${metricCol}::float AS value
    FROM message_snapshots
    WHERE flow_id = $1 AND week_start = $2 AND ${metricCol} IS NOT NULL
    ORDER BY ${metricCol} ${direction === 'above' ? 'DESC' : 'ASC'}
  `, [flowId, weekStart])

  const affected = msgRows.rows.filter((r) =>
    direction === 'above' ? r.value > threshold : r.value < threshold
  )

  let detail = ''

  if (affected.length > 0) {
    const names = affected
      .slice(0, 4)
      .map((r) => r.message_name || r.message_id.slice(0, 8))
      .join(', ')
    const pcts = affected
      .slice(0, 4)
      .map((r) => `${(r.value * 100).toFixed(1)}%`)
      .join(', ')
    detail = `${names} ${direction === 'above' ? 'above' : 'below'} threshold (${pcts}). ${affected.length} message${affected.length !== 1 ? 's' : ''} affected.\n`
  }

  const suggestion = SUGGESTION_TEMPLATES[metric] ?? ''
  return detail || suggestion ? `${detail}AI suggestion: ${suggestion}` : null
}

async function getUnresolvedMessageAlert(
  client: PoolClient,
  flowId: string,
  messageId: string,
  metric: string,
  threshold: number
): Promise<{ id: number } | null> {
  const rows = await client.query<{ id: number }>(
    `SELECT id FROM alerts
     WHERE flow_id = $1 AND message_id = $2 AND metric = $3 AND threshold = $4 AND resolved_at IS NULL
     LIMIT 1`,
    [flowId, messageId, metric, threshold]
  )
  return rows.rows[0] ?? null
}

async function createMessageAlert(
  client: PoolClient,
  flowId: string,
  messageId: string,
  metric: string,
  value: number,
  threshold: number,
  severity: AlertSeverity,
  aiSuggestion: string | null,
  weekStart: string | null = null
): Promise<void> {
  await client.query(
    `INSERT INTO alerts (flow_id, message_id, metric, value, threshold, severity, ai_suggestion, week_start)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [flowId, messageId, metric, value, threshold, severity, aiSuggestion, weekStart]
  )
}

async function resolveAlert(client: PoolClient, alertId: number): Promise<void> {
  await client.query(
    `UPDATE alerts SET resolved_at = NOW() WHERE id = $1`,
    [alertId]
  )
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface AlertEngineResult {
  created: number
  resolved: number
}

export async function runAlertEngine(weekStart: string): Promise<AlertEngineResult> {
  const [thresholds, flowSnaps, messageSnaps] = await Promise.all([
    getThresholds(),
    // Flow-level snapshots (catches spam, bounce, etc.)
    query<Partial<FlowSnapshot> & { flow_id: string; recipients: number }>(`
      SELECT flow_id, recipients, open_rate, click_rate, unsubscribe_rate,
             spam_complaint_rate, bounce_rate
      FROM flow_snapshots
      WHERE week_start = $1
    `, [weekStart]),
    // Message-level snapshots (for email-specific alerts)
    query<Partial<FlowSnapshot> & {
      flow_id: string
      message_id: string
      message_name: string | null
      recipients: number
    }>(`
      SELECT flow_id, message_id, message_name, recipients,
             open_rate, click_rate, unsubscribe_rate,
             spam_complaint_rate, bounce_rate
      FROM message_snapshots
      WHERE week_start = $1
    `, [weekStart]),
  ])

  // Track which flow+metric combos have message-level alerts
  // so we don't create duplicate flow-level alerts for those
  const messageAlertKeys = new Set<string>()

  const rules = buildRules(thresholds)
  let created = 0
  let resolved = 0

  await withTransaction(async (client) => {
    // ── Pass 1: message-level alerts (specific emails) ──
    for (const msg of messageSnaps) {
      for (const rule of rules) {
        const triggered = isTriggered(msg, rule)
        const existing = await getUnresolvedMessageAlert(
          client, msg.flow_id, msg.message_id, rule.metric, rule.threshold
        )

        if (triggered && !existing) {
          const suggestion = SUGGESTION_TEMPLATES[rule.metric] ?? null
          await createMessageAlert(
            client, msg.flow_id, msg.message_id, rule.metric,
            Number(msg[rule.metric]) ?? 0, rule.threshold, rule.severity, suggestion, weekStart
          )
          messageAlertKeys.add(`${msg.flow_id}:${rule.metric}:${rule.threshold}`)
          created++
        } else if (triggered && existing) {
          messageAlertKeys.add(`${msg.flow_id}:${rule.metric}:${rule.threshold}`)
        } else if (!triggered && existing) {
          await resolveAlert(client, existing.id)
          resolved++
        }
      }
    }

    // ── Pass 2: flow-level alerts (for flows without message-level data) ──
    for (const snap of flowSnaps) {
      for (const rule of rules) {
        const key = `${snap.flow_id}:${rule.metric}:${rule.threshold}`
        // Skip if we already have message-level alerts for this flow+metric
        if (messageAlertKeys.has(key)) continue

        const triggered = isTriggered(snap, rule)
        const existing = await getUnresolvedAlert(
          client, snap.flow_id, rule.metric, rule.threshold
        )

        if (triggered && !existing) {
          const suggestion = SUGGESTION_TEMPLATES[rule.metric] ?? null
          await createAlert(
            client, snap.flow_id, rule.metric,
            Number(snap[rule.metric]) ?? 0, rule.threshold, rule.severity, suggestion, weekStart
          )
          created++
        } else if (!triggered && existing) {
          await resolveAlert(client, existing.id)
          resolved++
        }
      }
    }

    // ── Pre-pass: auto-resolve stale drop alerts ──
    // A drop alert is stale when the underlying criteria no longer holds
    // (recipients fell below min, the drop is no longer significant, etc.)
    for (const dropMetric of ['revenue_drop', 'open_rate_drop', 'click_rate_drop']) {
      const staleAlerts = await findStaleDropAlerts(
        client, dropMetric, weekStart, thresholds
      )
      for (const a of staleAlerts) {
        await resolveAlert(client, a.id)
        resolved++
      }
    }

    // ── Pass 3a: message-level revenue-drop alerts ──
    const msgRevDrops = await messageRevenueDropCandidates(client, weekStart, thresholds)
    const flowsWithMsgRevDrop = new Set<string>()
    for (const drop of msgRevDrops) {
      const severity: AlertSeverity =
        drop.dropPct >= thresholds.revenue_drop_critical ? 'critical' : 'warning'
      const threshold =
        severity === 'critical' ? thresholds.revenue_drop_critical : thresholds.revenue_drop_warning

      const existing = await getUnresolvedMessageAlert(
        client, drop.flow_id, drop.message_id, 'revenue_drop', threshold
      )

      if (!existing) {
        const pctDown = Math.round(drop.dropPct * 100)
        const detail = `Email revenue fell from $${drop.prev_revenue.toFixed(0)} to $${drop.cur_revenue.toFixed(0)} (${pctDown}% drop).\nAI suggestion: ${SUGGESTION_TEMPLATES.revenue_drop}`
        await createMessageAlert(
          client, drop.flow_id, drop.message_id, 'revenue_drop',
          drop.dropPct, threshold, severity, detail, weekStart
        )
        created++
      }
      flowsWithMsgRevDrop.add(drop.flow_id)
    }

    // ── Pass 3b: flow-level revenue-drop alerts (only for flows without per-message signal) ──
    const revDrops = await revenueDropCandidates(client, weekStart, thresholds)
    for (const drop of revDrops) {
      // Skip if a message-level revenue drop alert already covers this flow
      if (flowsWithMsgRevDrop.has(drop.flow_id)) continue

      const severity: AlertSeverity =
        drop.dropPct >= thresholds.revenue_drop_critical ? 'critical' : 'warning'
      const threshold =
        severity === 'critical' ? thresholds.revenue_drop_critical : thresholds.revenue_drop_warning

      const existing = await getUnresolvedAlert(client, drop.flow_id, 'revenue_drop', threshold)

      if (!existing) {
        const pctDown = Math.round(drop.dropPct * 100)
        const detail = `Revenue fell from $${drop.prev_revenue.toFixed(0)} to $${drop.cur_revenue.toFixed(0)} (${pctDown}% drop).\nAI suggestion: ${SUGGESTION_TEMPLATES.revenue_drop}`
        await createAlert(
          client, drop.flow_id, 'revenue_drop',
          drop.dropPct, threshold, severity, detail, weekStart
        )
        created++
      }
    }

    // ── Pass 4: open-rate + click-rate drop alerts ──
    const rateDrops = [
      { metricCol: 'open_rate',  metricName: 'open_rate_drop',  warnPct: thresholds.open_drop_warning,  critPct: thresholds.open_drop_critical,  label: 'Open rate' },
      { metricCol: 'click_rate', metricName: 'click_rate_drop', warnPct: thresholds.click_drop_warning, critPct: thresholds.click_drop_critical, label: 'Click rate' },
    ]
    for (const config of rateDrops) {
      // Message-level drops
      const msgDrops = await messageRateDropCandidates(client, weekStart, config.metricCol, config.warnPct, thresholds.min_recipients)
      const flowsWithMsgDrop = new Set<string>()
      for (const drop of msgDrops) {
        const severity: AlertSeverity = drop.dropPct >= config.critPct ? 'critical' : 'warning'
        const threshold = severity === 'critical' ? config.critPct : config.warnPct

        const existing = await getUnresolvedMessageAlert(
          client, drop.flow_id, drop.message_id, config.metricName, threshold
        )
        if (!existing) {
          const pctDown = Math.round(drop.dropPct * 100)
          const detail = `${config.label} fell from ${(drop.prev * 100).toFixed(1)}% to ${(drop.cur * 100).toFixed(1)}% (${pctDown}% drop).\nAI suggestion: ${SUGGESTION_TEMPLATES[config.metricName] ?? ''}`
          await createMessageAlert(
            client, drop.flow_id, drop.message_id, config.metricName,
            drop.dropPct, threshold, severity, detail, weekStart
          )
          created++
        }
        flowsWithMsgDrop.add(drop.flow_id)
      }

      // Flow-level drops (fallback for flows without per-message signal)
      const flowDrops = await flowRateDropCandidates(client, weekStart, config.metricCol, config.warnPct, thresholds.min_recipients)
      for (const drop of flowDrops) {
        if (flowsWithMsgDrop.has(drop.flow_id)) continue

        const severity: AlertSeverity = drop.dropPct >= config.critPct ? 'critical' : 'warning'
        const threshold = severity === 'critical' ? config.critPct : config.warnPct

        const existing = await getUnresolvedAlert(client, drop.flow_id, config.metricName, threshold)
        if (!existing) {
          const pctDown = Math.round(drop.dropPct * 100)
          const detail = `${config.label} fell from ${(drop.prev * 100).toFixed(1)}% to ${(drop.cur * 100).toFixed(1)}% (${pctDown}% drop).\nAI suggestion: ${SUGGESTION_TEMPLATES[config.metricName] ?? ''}`
          await createAlert(
            client, drop.flow_id, config.metricName,
            drop.dropPct, threshold, severity, detail, weekStart
          )
          created++
        }
      }
    }
  })

  console.log(`[alert-engine] ${created} created, ${resolved} resolved`)
  return { created, resolved }
}

/**
 * Find flows whose revenue dropped from last week (rn=2) to this week (rn=1).
 * Only considers flows where prior revenue > min threshold (avoid noise on trivial flows).
 */
async function revenueDropCandidates(
  client: PoolClient,
  weekStart: string,
  thresholds: AlertThresholds
): Promise<{ flow_id: string; cur_revenue: number; prev_revenue: number; dropPct: number }[]> {
  const rows = await client.query<{
    flow_id: string
    cur_revenue: string | null
    prev_revenue: string | null
    cur_recipients: string | null
  }>(`
    WITH ranked AS (
      SELECT flow_id, revenue, recipients,
             ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY week_start DESC) AS rn
      FROM flow_snapshots
      WHERE week_start <= $1
    )
    SELECT
      flow_id,
      COALESCE(SUM(CASE WHEN rn = 1 THEN revenue END), 0)::text    AS cur_revenue,
      COALESCE(SUM(CASE WHEN rn = 2 THEN revenue END), 0)::text    AS prev_revenue,
      COALESCE(SUM(CASE WHEN rn = 1 THEN recipients END), 0)::text AS cur_recipients
    FROM ranked
    WHERE rn <= 2
    GROUP BY flow_id
  `, [weekStart])

  const candidates = []
  for (const row of rows.rows) {
    const cur = Number(row.cur_revenue ?? 0)
    const prev = Number(row.prev_revenue ?? 0)
    const curRecip = Number(row.cur_recipients ?? 0)
    if (curRecip < thresholds.min_recipients) continue  // min recipients gate
    if (prev < thresholds.revenue_drop_min) continue    // skip trivial flows
    if (cur >= prev) continue
    const dropPct = (prev - cur) / prev
    if (dropPct < thresholds.revenue_drop_warning) continue
    candidates.push({ flow_id: row.flow_id, cur_revenue: cur, prev_revenue: prev, dropPct })
  }
  return candidates
}

/**
 * Find individual messages whose revenue dropped from last week to this week.
 * Only considers messages where prior revenue > min threshold (avoid noise).
 */
async function messageRevenueDropCandidates(
  client: PoolClient,
  weekStart: string,
  thresholds: AlertThresholds
): Promise<{ flow_id: string; message_id: string; cur_revenue: number; prev_revenue: number; dropPct: number }[]> {
  const rows = await client.query<{
    flow_id: string
    message_id: string
    cur_revenue: string | null
    prev_revenue: string | null
    cur_recipients: string | null
  }>(`
    WITH ranked AS (
      SELECT flow_id, message_id, revenue, recipients,
             ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY week_start DESC) AS rn
      FROM message_snapshots
      WHERE week_start <= $1
    )
    SELECT
      flow_id,
      message_id,
      COALESCE(SUM(CASE WHEN rn = 1 THEN revenue END), 0)::text    AS cur_revenue,
      COALESCE(SUM(CASE WHEN rn = 2 THEN revenue END), 0)::text    AS prev_revenue,
      COALESCE(SUM(CASE WHEN rn = 1 THEN recipients END), 0)::text AS cur_recipients
    FROM ranked
    WHERE rn <= 2
    GROUP BY flow_id, message_id
  `, [weekStart])

  const candidates = []
  for (const row of rows.rows) {
    const cur = Number(row.cur_revenue ?? 0)
    const prev = Number(row.prev_revenue ?? 0)
    const curRecip = Number(row.cur_recipients ?? 0)
    if (curRecip < thresholds.min_recipients) continue
    if (prev < thresholds.revenue_drop_min) continue
    if (cur >= prev) continue
    const dropPct = (prev - cur) / prev
    if (dropPct < thresholds.revenue_drop_warning) continue
    candidates.push({
      flow_id: row.flow_id,
      message_id: row.message_id,
      cur_revenue: cur,
      prev_revenue: prev,
      dropPct,
    })
  }
  return candidates
}

/**
 * Find messages whose rate metric (open_rate or click_rate) dropped this week vs last week.
 * Uses weighted rate calculation — compares raw proportion (rate * recipients).
 */
async function messageRateDropCandidates(
  client: PoolClient,
  weekStart: string,
  metricCol: string,  // 'open_rate' or 'click_rate'
  dropThreshold: number,
  minRecipients: number
): Promise<{ flow_id: string; message_id: string; cur: number; prev: number; dropPct: number }[]> {
  const rows = await client.query<{
    flow_id: string
    message_id: string
    cur_rate: string | null
    prev_rate: string | null
    cur_recipients: string | null
    prev_recipients: string | null
  }>(`
    WITH ranked AS (
      SELECT flow_id, message_id, ${metricCol} AS rate, recipients,
             ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY week_start DESC) AS rn
      FROM message_snapshots
      WHERE week_start <= $1
    )
    SELECT
      flow_id,
      message_id,
      MAX(CASE WHEN rn = 1 THEN rate END)::text       AS cur_rate,
      MAX(CASE WHEN rn = 2 THEN rate END)::text       AS prev_rate,
      MAX(CASE WHEN rn = 1 THEN recipients END)::text AS cur_recipients,
      MAX(CASE WHEN rn = 2 THEN recipients END)::text AS prev_recipients
    FROM ranked
    WHERE rn <= 2
    GROUP BY flow_id, message_id
  `, [weekStart])

  const candidates = []
  for (const row of rows.rows) {
    const cur = row.cur_rate !== null ? Number(row.cur_rate) : null
    const prev = row.prev_rate !== null ? Number(row.prev_rate) : null
    const curRecip = Number(row.cur_recipients ?? 0)
    const prevRecip = Number(row.prev_recipients ?? 0)
    if (cur == null || prev == null || prev === 0) continue
    // Require enough volume in both weeks
    if (curRecip < minRecipients) continue
    if (prevRecip < minRecipients) continue
    if (cur >= prev) continue
    const dropPct = (prev - cur) / prev
    if (dropPct < dropThreshold) continue
    candidates.push({
      flow_id: row.flow_id,
      message_id: row.message_id,
      cur, prev, dropPct,
    })
  }
  return candidates
}

/** Same, but at flow level (using flow_snapshots). */
async function flowRateDropCandidates(
  client: PoolClient,
  weekStart: string,
  metricCol: string,
  dropThreshold: number,
  minRecipients: number
): Promise<{ flow_id: string; cur: number; prev: number; dropPct: number }[]> {
  const rows = await client.query<{
    flow_id: string
    cur_rate: string | null
    prev_rate: string | null
    cur_recipients: string | null
    prev_recipients: string | null
  }>(`
    WITH ranked AS (
      SELECT flow_id, ${metricCol} AS rate, recipients,
             ROW_NUMBER() OVER (PARTITION BY flow_id ORDER BY week_start DESC) AS rn
      FROM flow_snapshots
      WHERE week_start <= $1
    )
    SELECT
      flow_id,
      MAX(CASE WHEN rn = 1 THEN rate END)::text       AS cur_rate,
      MAX(CASE WHEN rn = 2 THEN rate END)::text       AS prev_rate,
      MAX(CASE WHEN rn = 1 THEN recipients END)::text AS cur_recipients,
      MAX(CASE WHEN rn = 2 THEN recipients END)::text AS prev_recipients
    FROM ranked
    WHERE rn <= 2
    GROUP BY flow_id
  `, [weekStart])

  const candidates = []
  for (const row of rows.rows) {
    const cur = row.cur_rate !== null ? Number(row.cur_rate) : null
    const prev = row.prev_rate !== null ? Number(row.prev_rate) : null
    const curRecip = Number(row.cur_recipients ?? 0)
    const prevRecip = Number(row.prev_recipients ?? 0)
    if (cur == null || prev == null || prev === 0) continue
    if (curRecip < minRecipients) continue
    if (prevRecip < minRecipients) continue
    if (cur >= prev) continue
    const dropPct = (prev - cur) / prev
    if (dropPct < dropThreshold) continue
    candidates.push({
      flow_id: row.flow_id,
      cur, prev, dropPct,
    })
  }
  return candidates
}

/**
 * Returns active drop alerts whose most recent data no longer satisfies the alert criteria.
 * Used to auto-resolve stale alerts when:
 *  - the message/flow latest recipients fell below min_recipients
 *  - the metric no longer shows a drop above threshold
 *  - the message/flow no longer has data at all
 */
async function findStaleDropAlerts(
  client: PoolClient,
  metric: string,
  weekStart: string,
  thresholds: AlertThresholds
): Promise<{ id: number }[]> {
  if (metric === 'revenue_drop') {
    // Stale if: latest recipients < min_recipients, or prev revenue < min, or cur >= prev, or drop < threshold
    const result = await client.query<{ id: number }>(`
      WITH active AS (
        SELECT a.id, a.flow_id, a.message_id, a.threshold::float AS threshold
        FROM alerts a
        WHERE a.metric = 'revenue_drop' AND a.resolved_at IS NULL
      ),
      msg_stats AS (
        SELECT a.id,
               MAX(CASE WHEN ms.rn = 1 THEN ms.recipients END) AS cur_recip,
               MAX(CASE WHEN ms.rn = 1 THEN ms.revenue END)    AS cur_rev,
               MAX(CASE WHEN ms.rn = 2 THEN ms.revenue END)    AS prev_rev
        FROM active a
        JOIN LATERAL (
          SELECT recipients, revenue,
                 ROW_NUMBER() OVER (ORDER BY week_start DESC) AS rn
          FROM message_snapshots
          WHERE message_id = a.message_id AND week_start <= $1::date
        ) ms ON ms.rn <= 2
        WHERE a.message_id IS NOT NULL
        GROUP BY a.id
      ),
      flow_stats AS (
        SELECT a.id,
               MAX(CASE WHEN fs.rn = 1 THEN fs.recipients END) AS cur_recip,
               MAX(CASE WHEN fs.rn = 1 THEN fs.revenue END)    AS cur_rev,
               MAX(CASE WHEN fs.rn = 2 THEN fs.revenue END)    AS prev_rev
        FROM active a
        JOIN LATERAL (
          SELECT recipients, revenue,
                 ROW_NUMBER() OVER (ORDER BY week_start DESC) AS rn
          FROM flow_snapshots
          WHERE flow_id = a.flow_id AND week_start <= $1::date
        ) fs ON fs.rn <= 2
        WHERE a.message_id IS NULL
        GROUP BY a.id
      )
      SELECT id FROM (
        SELECT * FROM msg_stats
        UNION ALL
        SELECT * FROM flow_stats
      ) combined
      WHERE cur_recip IS NULL
         OR cur_recip < $2
         OR prev_rev IS NULL
         OR prev_rev < $3
         OR cur_rev >= prev_rev
         OR (prev_rev - cur_rev) / prev_rev < $4
    `, [weekStart, thresholds.min_recipients, thresholds.revenue_drop_min, thresholds.revenue_drop_warning])
    return result.rows
  }

  if (metric === 'open_rate_drop' || metric === 'click_rate_drop') {
    const metricCol = metric === 'open_rate_drop' ? 'open_rate' : 'click_rate'
    const dropThreshold = metric === 'open_rate_drop' ? thresholds.open_drop_warning : thresholds.click_drop_warning

    const result = await client.query<{ id: number }>(`
      WITH active AS (
        SELECT a.id, a.flow_id, a.message_id
        FROM alerts a
        WHERE a.metric = $1 AND a.resolved_at IS NULL
      ),
      msg_stats AS (
        SELECT a.id,
               MAX(CASE WHEN ms.rn = 1 THEN ms.recipients END) AS cur_recip,
               MAX(CASE WHEN ms.rn = 2 THEN ms.recipients END) AS prev_recip,
               MAX(CASE WHEN ms.rn = 1 THEN ms.${metricCol} END) AS cur_rate,
               MAX(CASE WHEN ms.rn = 2 THEN ms.${metricCol} END) AS prev_rate
        FROM active a
        JOIN LATERAL (
          SELECT recipients, ${metricCol},
                 ROW_NUMBER() OVER (ORDER BY week_start DESC) AS rn
          FROM message_snapshots
          WHERE message_id = a.message_id AND week_start <= $2::date
        ) ms ON ms.rn <= 2
        WHERE a.message_id IS NOT NULL
        GROUP BY a.id
      ),
      flow_stats AS (
        SELECT a.id,
               MAX(CASE WHEN fs.rn = 1 THEN fs.recipients END) AS cur_recip,
               MAX(CASE WHEN fs.rn = 2 THEN fs.recipients END) AS prev_recip,
               MAX(CASE WHEN fs.rn = 1 THEN fs.${metricCol} END) AS cur_rate,
               MAX(CASE WHEN fs.rn = 2 THEN fs.${metricCol} END) AS prev_rate
        FROM active a
        JOIN LATERAL (
          SELECT recipients, ${metricCol},
                 ROW_NUMBER() OVER (ORDER BY week_start DESC) AS rn
          FROM flow_snapshots
          WHERE flow_id = a.flow_id AND week_start <= $2::date
        ) fs ON fs.rn <= 2
        WHERE a.message_id IS NULL
        GROUP BY a.id
      )
      SELECT id FROM (
        SELECT * FROM msg_stats
        UNION ALL
        SELECT * FROM flow_stats
      ) combined
      WHERE cur_recip IS NULL
         OR cur_recip < $3
         OR prev_recip IS NULL
         OR prev_recip < $3
         OR prev_rate IS NULL OR prev_rate = 0
         OR cur_rate IS NULL
         OR cur_rate >= prev_rate
         OR (prev_rate - cur_rate) / prev_rate < $4
    `, [metric, weekStart, thresholds.min_recipients, dropThreshold])
    return result.rows
  }

  return []
}

// ─── Read helpers used by API routes ─────────────────────────────────────────

export interface AlertWithFlow {
  id: number
  flow_id: string
  flow_name: string
  message_id: string | null
  message_name: string | null
  severity: AlertSeverity
  metric: string
  value: number
  threshold: number
  ai_suggestion: string | null
  monday_task_id: string | null
  created_at: string
  resolved_at: string | null
  week_start: string | null   // data week the alert refers to (YYYY-MM-DD)
}

export async function getActiveAlerts(): Promise<AlertWithFlow[]> {
  return query<AlertWithFlow>(`
    SELECT a.id, a.flow_id, f.name AS flow_name,
           a.message_id, ms.message_name,
           a.severity, a.metric,
           a.value::float, a.threshold::float, a.ai_suggestion,
           a.monday_task_id, a.created_at, a.resolved_at,
           a.week_start::text AS week_start
    FROM alerts a
    JOIN flows f USING (flow_id)
    LEFT JOIN LATERAL (
      SELECT message_name FROM message_snapshots
      WHERE message_id = a.message_id
      LIMIT 1
    ) ms ON true
    WHERE a.resolved_at IS NULL
    ORDER BY
      CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
      a.created_at DESC
  `)
}

export async function getFlowAlerts(flowId: string): Promise<AlertWithFlow[]> {
  return query<AlertWithFlow>(`
    SELECT a.id, a.flow_id, f.name AS flow_name,
           a.message_id, ms.message_name,
           a.severity, a.metric,
           a.value::float, a.threshold::float, a.ai_suggestion,
           a.monday_task_id, a.created_at, a.resolved_at,
           a.week_start::text AS week_start
    FROM alerts a
    JOIN flows f USING (flow_id)
    LEFT JOIN LATERAL (
      SELECT message_name FROM message_snapshots
      WHERE message_id = a.message_id
      LIMIT 1
    ) ms ON true
    WHERE a.flow_id = $1 AND a.resolved_at IS NULL
    ORDER BY
      CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END
  `, [flowId])
}

export async function resolveAlertById(alertId: number): Promise<void> {
  await query(`UPDATE alerts SET resolved_at = NOW() WHERE id = $1`, [alertId])
}

export async function saveAiSuggestion(alertId: number, suggestion: string): Promise<void> {
  await query(`UPDATE alerts SET ai_suggestion = $1 WHERE id = $2`, [suggestion, alertId])
}

export async function saveMondayTaskId(alertId: number, taskId: string): Promise<void> {
  await query(`UPDATE alerts SET monday_task_id = $1 WHERE id = $2`, [taskId, alertId])
}
