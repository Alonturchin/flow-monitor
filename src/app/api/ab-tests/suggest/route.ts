import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { suggestTestsForMessage, chatAboutTests, type ChatMessage } from '@/lib/claude'
import type { Flow, FlowSnapshot } from '@/types'
import type { AlertWithFlow } from '@/lib/alert-engine'

/**
 * POST /api/ab-tests/suggest
 * Body: { message_id: string, avoidHypotheses?: string[], history?: ChatMessage[] }
 *
 * If history is provided → returns a chat reply string in `reply`.
 * Otherwise → returns an array of suggestions in `suggestions`.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 400 })
  }

  try {
    const body = await req.json() as {
      message_id: string
      avoidHypotheses?: string[]
      history?: ChatMessage[]
    }
    const { message_id, avoidHypotheses, history } = body

    if (!message_id) {
      return NextResponse.json({ error: 'message_id required' }, { status: 400 })
    }

    // Find which flow this message belongs to
    const msgRow = await queryOne<{ flow_id: string; message_name: string | null }>(`
      SELECT flow_id, message_name FROM message_snapshots
      WHERE message_id = $1 ORDER BY week_start DESC LIMIT 1
    `, [message_id])

    if (!msgRow) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const flow = await queryOne<Flow>(`
      SELECT flow_id, name, tags, status, trigger_type, updated_at FROM flows WHERE flow_id = $1
    `, [msgRow.flow_id])
    if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })

    // Current + historical stats for this message (up to 8 weeks back)
    const statsRows = await query<Partial<FlowSnapshot>>(`
      SELECT recipients, open_rate::float, click_rate::float, bounce_rate::float,
             unsubscribe_rate::float, spam_complaint_rate::float, revenue::float,
             revenue_per_recipient::float, week_start::text
      FROM message_snapshots
      WHERE message_id = $1
      ORDER BY week_start DESC
      LIMIT 8
    `, [message_id])

    const currentStats = statsRows[0] ?? null
    const historicalStats = statsRows.slice(1).reverse()  // oldest first

    // Active alerts on this email
    const alertsRaw = await query<Pick<AlertWithFlow, 'severity' | 'metric' | 'value' | 'threshold'>>(`
      SELECT severity, metric, value::float, threshold::float
      FROM alerts
      WHERE message_id = $1 AND resolved_at IS NULL
    `, [message_id])

    const input = {
      flow: {
        name: flow.name,
        status: flow.status,
        trigger_type: flow.trigger_type,
        tags: flow.tags ?? [],
      },
      messageName: msgRow.message_name,
      messageId: message_id,
      currentStats,
      historicalStats,
      activeAlerts: alertsRaw,
      avoidHypotheses,
    }

    if (history && history.length > 0) {
      const reply = await chatAboutTests(input, history)
      return NextResponse.json({ reply })
    } else {
      const suggestions = await suggestTestsForMessage(input)
      return NextResponse.json({ suggestions })
    }
  } catch (err) {
    console.error('[api/ab-tests/suggest]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
