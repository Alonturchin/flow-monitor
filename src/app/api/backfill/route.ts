import { NextResponse } from 'next/server'
import { runWeeklySync } from '@/lib/data-sync'

// Prevent concurrent backfills
let isBackfilling = false
let progress = { completed: 0, total: 0, currentWeek: '' }

/**
 * POST /api/backfill?weeks=52
 * Backfills historical weekly snapshots (and alerts) for the past N weeks.
 * Runs sequentially, ~5 min per week due to Klaviyo rate limits.
 *
 * GET /api/backfill — returns current progress.
 */
export async function POST(req: Request) {
  if (isBackfilling) {
    return NextResponse.json(
      { error: 'Backfill already in progress', progress },
      { status: 409 }
    )
  }

  const { searchParams } = new URL(req.url)
  const weeks = Math.min(Math.max(1, parseInt(searchParams.get('weeks') ?? '52', 10) || 52), 104)

  isBackfilling = true
  progress = { completed: 0, total: weeks, currentWeek: '' }

  // Run async — don't block response
  ;(async () => {
    try {
      const now = new Date()
      // Start from the Monday of the most recently completed week
      const day = now.getUTCDay()
      const daysBack = day === 0 ? 7 : day
      const latestMonday = new Date(now)
      latestMonday.setUTCDate(now.getUTCDate() - daysBack)
      latestMonday.setUTCHours(0, 0, 0, 0)

      // Iterate backwards from latest Monday, N weeks
      for (let i = 0; i < weeks; i++) {
        const weekStart = new Date(latestMonday)
        weekStart.setUTCDate(latestMonday.getUTCDate() - (i * 7))
        const weekStr = weekStart.toISOString().slice(0, 10)
        progress.currentWeek = weekStr
        console.log(`[backfill] Syncing week ${i + 1}/${weeks}: ${weekStr}`)

        try {
          // Skip alert generation on historical weeks — only run on the latest (i === 0)
          await runWeeklySync(weekStart, { skipAlerts: i !== 0 })
        } catch (err) {
          console.error(`[backfill] Week ${weekStr} failed:`, err)
          // Continue with next week even if one fails
        }

        progress.completed = i + 1
      }

      console.log('[backfill] Complete:', progress)
    } catch (err) {
      console.error('[backfill] Fatal error:', err)
    } finally {
      isBackfilling = false
    }
  })()

  return NextResponse.json({
    ok: true,
    message: `Backfill started for ${weeks} weeks. Poll GET /api/backfill for progress.`,
    progress,
  })
}

export async function GET() {
  return NextResponse.json({
    isBackfilling,
    progress,
  })
}
