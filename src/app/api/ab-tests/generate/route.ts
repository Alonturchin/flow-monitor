import { NextResponse } from 'next/server'
import { getFlowDetail } from '@/lib/queries'
import { getFlowAlerts } from '@/lib/alert-engine'
import { generateAbTests } from '@/lib/claude'
import { calcHealthScore } from '@/lib/health-score'
import { query } from '@/lib/db'

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 400 })
  }

  try {
    const { flow_id } = (await req.json()) as { flow_id: string }
    if (!flow_id) {
      return NextResponse.json({ error: 'flow_id is required' }, { status: 400 })
    }

    const [detail, alerts] = await Promise.all([
      getFlowDetail(flow_id),
      getFlowAlerts(flow_id),
    ])

    if (!detail) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    const recipients = detail.snapshot?.recipients ?? 0
    if (recipients < 500) {
      return NextResponse.json({
        error: `Not enough recipients (${recipients.toLocaleString()} < 500). A/B tests need at least 500 recipients for statistical significance.`,
        skipped: true,
      }, { status: 422 })
    }

    const healthScore = calcHealthScore(detail.snapshot ?? {})
    const suggestions = await generateAbTests({
      flow: detail.flow,
      snapshot: detail.snapshot,
      alerts,
      healthScore,
    })

    if (!suggestions.length) {
      return NextResponse.json({ ok: true, generated: 0, tests: [] })
    }

    const inserted = []
    for (const s of suggestions) {
      const rows = await query<{ id: string }>(
        `INSERT INTO ab_tests (flow_id, hypothesis, suggested_change, metric_to_watch, confidence)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text`,
        [flow_id, s.hypothesis, s.suggested_change, s.metric_to_watch, s.confidence]
      )
      inserted.push({
        id: Number(rows[0].id),
        flow_id,
        flow_name: detail.flow.name,
        hypothesis: s.hypothesis,
        suggested_change: s.suggested_change,
        metric_to_watch: s.metric_to_watch,
        confidence: s.confidence,
        status: 'pending' as const,
        result: null,
      })
    }

    return NextResponse.json({ ok: true, generated: inserted.length, tests: inserted })
  } catch (err) {
    console.error('[api/ab-tests/generate]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
