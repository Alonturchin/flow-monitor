import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const flowId = searchParams.get('flow_id')
    const status = searchParams.get('status')

    const conditions: string[] = []
    const params: unknown[] = []

    if (flowId) {
      params.push(flowId)
      conditions.push(`t.flow_id = $${params.length}`)
    }
    if (status) {
      params.push(status)
      conditions.push(`t.status = $${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await query<{
      id: string
      flow_id: string
      flow_name: string
      message_id: string | null
      message_name: string | null
      hypothesis: string
      suggested_change: string
      metric_to_watch: string
      confidence: string
      status: string
      result: string | null
      rationale: string | null
      expected_impact: string | null
      monday_task_id: string | null
      created_at: string
    }>(`
      SELECT t.id::text, t.flow_id, f.name AS flow_name, t.message_id,
             ms.message_name,
             t.hypothesis, t.suggested_change, t.metric_to_watch,
             t.confidence::text, t.status, t.result,
             t.rationale, t.expected_impact, t.monday_task_id,
             t.created_at::text
      FROM ab_tests t
      JOIN flows f ON f.flow_id = t.flow_id
      LEFT JOIN LATERAL (
        SELECT message_name FROM message_snapshots WHERE message_id = t.message_id LIMIT 1
      ) ms ON true
      ${where}
      ORDER BY t.created_at DESC
    `, params)

    const tests = rows.map((r) => ({
      ...r,
      id: Number(r.id),
      confidence: Number(r.confidence),
    }))

    return NextResponse.json({ tests, count: tests.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST /api/ab-tests — create a test from a saved suggestion. */
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      flow_id: string
      message_id?: string
      hypothesis: string
      suggested_change: string
      metric_to_watch: string
      confidence: number
      rationale?: string
      expected_impact?: string
    }

    if (!body.flow_id || !body.hypothesis || !body.suggested_change || !body.metric_to_watch) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const row = await query<{ id: string }>(`
      INSERT INTO ab_tests
        (flow_id, message_id, hypothesis, suggested_change, metric_to_watch, confidence, rationale, expected_impact)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id::text
    `, [
      body.flow_id,
      body.message_id ?? null,
      body.hypothesis,
      body.suggested_change,
      body.metric_to_watch,
      Math.min(1, Math.max(0, body.confidence ?? 0.5)),
      body.rationale ?? null,
      body.expected_impact ?? null,
    ])

    return NextResponse.json({ ok: true, id: Number(row[0]?.id) })
  } catch (err) {
    console.error('[api/ab-tests] POST', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
