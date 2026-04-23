import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const key = searchParams.get('key')

    if (key) {
      const row = await queryOne<{ key: string; value: unknown; updated_at: string }>(
        `SELECT key, value, updated_at::text FROM app_settings WHERE key = $1`,
        [key]
      )
      return row
        ? NextResponse.json(row)
        : NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const rows = await query<{ key: string; value: unknown; updated_at: string }>(
      `SELECT key, value, updated_at::text FROM app_settings ORDER BY key`
    )
    return NextResponse.json({ settings: rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const { key, value } = (await req.json()) as { key: string; value: unknown }
    if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    )

    // If alert thresholds changed, re-evaluate alerts in the background so the UI
    // auto-reflects the new rules (e.g. raising min_recipients resolves low-volume alerts).
    if (key === 'alert_thresholds') {
      triggerAlertRerunInBackground().catch((err) => {
        console.error('[settings PATCH] alert re-run failed:', err)
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/**
 * Kicks off the alert engine asynchronously — doesn't block the PATCH response.
 * Runs against the most recent snapshot week.
 */
async function triggerAlertRerunInBackground(): Promise<void> {
  const { runAlertEngine } = await import('@/lib/alert-engine')
  const row = await queryOne<{ ws: string }>(
    `SELECT MAX(week_start)::text AS ws FROM flow_snapshots`
  )
  if (row?.ws) {
    console.log('[settings PATCH] Auto-running alert engine for week', row.ws)
    const result = await runAlertEngine(row.ws)
    console.log('[settings PATCH] Alert engine done:', result)
  }
}
