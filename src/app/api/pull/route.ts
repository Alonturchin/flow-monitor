import { NextResponse } from 'next/server'
import { runWeeklySync, type SyncResult } from '@/lib/data-sync'

// In-flight pull: prevents concurrent syncs that would fight for the rate limit
let activeSyncPromise: Promise<SyncResult> | null = null

export async function POST() {
  if (!process.env.KLAVIYO_API_KEY) {
    return NextResponse.json(
      { error: 'KLAVIYO_API_KEY is not configured' },
      { status: 400 }
    )
  }

  // If a sync is already running, wait for it instead of starting a new one
  if (activeSyncPromise) {
    console.log('[api/pull] Sync already in progress — reusing it')
    try {
      const result = await activeSyncPromise
      return NextResponse.json({ ok: true, _shared: true, ...result })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // Start a new sync
  activeSyncPromise = runWeeklySync()
  try {
    const result = await activeSyncPromise
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[api/pull] Sync failed:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  } finally {
    activeSyncPromise = null
  }
}
