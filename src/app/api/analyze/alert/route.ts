import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { analyzeAlert, chatAboutAlert, type ChatMessage } from '@/lib/claude'
import { saveAiSuggestion } from '@/lib/alert-engine'
import type { Flow, FlowSnapshot } from '@/types'

type HistSnap = Partial<FlowSnapshot> & { week_start?: string }

/**
 * POST /api/analyze/alert
 * Body: { alert_id: number, history?: ChatMessage[] }
 *
 * If history is omitted → returns fresh single-shot analysis.
 * If history is provided → continues the conversation.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 400 })
  }

  try {
    const body = await req.json() as { alert_id: number; history?: ChatMessage[] }
    const { alert_id, history } = body

    if (!alert_id) {
      return NextResponse.json({ error: 'alert_id required' }, { status: 400 })
    }

    // Load alert + flow + snapshot data
    const alert = await queryOne<{
      id: number
      flow_id: string
      message_id: string | null
      metric: string
      value: number
      threshold: number
      severity: string
      week_start: string | null
    }>(`
      SELECT id, flow_id, message_id, metric, value::float, threshold::float, severity, week_start::text
      FROM alerts
      WHERE id = $1
    `, [alert_id])

    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }

    const flow = await queryOne<Flow>(`
      SELECT flow_id, name, tags, status, trigger_type, updated_at FROM flows WHERE flow_id = $1
    `, [alert.flow_id])
    if (!flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    // Load message + flow stats — current week AND up to 12 weeks of history
    // so Claude can reason about trends, not just the snapshot in isolation.
    const [messageStats, flowStats, messageName, messageHistory, flowHistory] = await Promise.all([
      alert.message_id
        ? queryOne<Partial<FlowSnapshot>>(`
            SELECT recipients, open_rate::float, click_rate::float, bounce_rate::float,
                   unsubscribe_rate::float, spam_complaint_rate::float, revenue::float,
                   revenue_per_recipient::float
            FROM message_snapshots
            WHERE message_id = $1 AND ($2::date IS NULL OR week_start = $2::date)
            ORDER BY week_start DESC LIMIT 1
          `, [alert.message_id, alert.week_start])
        : Promise.resolve(null),
      queryOne<Partial<FlowSnapshot>>(`
        SELECT recipients, open_rate::float, click_rate::float, bounce_rate::float,
               unsubscribe_rate::float, spam_complaint_rate::float, revenue::float,
               revenue_per_recipient::float
        FROM flow_snapshots
        WHERE flow_id = $1 AND ($2::date IS NULL OR week_start = $2::date)
        ORDER BY week_start DESC LIMIT 1
      `, [alert.flow_id, alert.week_start]),
      alert.message_id
        ? queryOne<{ message_name: string | null }>(`
            SELECT message_name FROM message_snapshots
            WHERE message_id = $1 AND message_name IS NOT NULL
            LIMIT 1
          `, [alert.message_id])
        : Promise.resolve(null),
      // Message history (prior weeks before the alert's week)
      alert.message_id
        ? query<HistSnap>(`
            SELECT week_start::text, recipients, open_rate::float, click_rate::float,
                   bounce_rate::float, unsubscribe_rate::float,
                   spam_complaint_rate::float, revenue::float, revenue_per_recipient::float
            FROM message_snapshots
            WHERE message_id = $1 AND ($2::date IS NULL OR week_start < $2::date)
            ORDER BY week_start DESC
            LIMIT 12
          `, [alert.message_id, alert.week_start])
        : Promise.resolve([]),
      // Flow history
      query<HistSnap>(`
        SELECT week_start::text, recipients, open_rate::float, click_rate::float,
               bounce_rate::float, unsubscribe_rate::float,
               spam_complaint_rate::float, revenue::float, revenue_per_recipient::float
        FROM flow_snapshots
        WHERE flow_id = $1 AND ($2::date IS NULL OR week_start < $2::date)
        ORDER BY week_start DESC
        LIMIT 12
      `, [alert.flow_id, alert.week_start]),
    ])

    // Prefer message history if this is a message-level alert, else flow history
    const history_snaps = (alert.message_id && messageHistory.length > 0)
      ? messageHistory
      : flowHistory

    const input = {
      flow: {
        name: flow.name,
        status: flow.status,
        trigger_type: flow.trigger_type,
        tags: flow.tags ?? [],
      },
      alert: {
        metric: alert.metric,
        value: Number(alert.value),
        threshold: Number(alert.threshold),
        severity: alert.severity,
        message_name: messageName?.message_name ?? null,
        message_id: alert.message_id,
      },
      messageStats,
      flowStats,
      weekStart: alert.week_start,
      historicalSnapshots: history_snaps,
    }

    let reply: string
    if (history && history.length > 0) {
      reply = await chatAboutAlert(input, history)
    } else {
      reply = await analyzeAlert(input)
      // Save initial analysis to the alert's ai_suggestion field for future reference
      if (reply) {
        try { await saveAiSuggestion(alert_id, reply) } catch {}
      }
    }

    return NextResponse.json({ reply })
  } catch (err) {
    console.error('[api/analyze/alert]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
