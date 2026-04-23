import { NextResponse } from 'next/server'
import { runAlertEngine } from '@/lib/alert-engine'
import { queryOne } from '@/lib/db'

/**
 * POST /api/alerts/rerun
 * Re-runs the alert engine against existing DB snapshots (no Klaviyo call).
 * Optionally accepts ?week_start=YYYY-MM-DD; defaults to the latest snapshot week.
 */
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    let weekStart = searchParams.get('week_start')

    if (!weekStart) {
      const row = await queryOne<{ ws: string }>(
        `SELECT MAX(week_start)::text AS ws FROM flow_snapshots`
      )
      weekStart = row?.ws ?? null
    }

    if (!weekStart) {
      return NextResponse.json({ error: 'No snapshots in DB to evaluate' }, { status: 400 })
    }

    const result = await runAlertEngine(weekStart)
    return NextResponse.json({ ok: true, weekStart, ...result })
  } catch (err) {
    console.error('[api/alerts/rerun]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
