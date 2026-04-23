// Weekly cron scheduler — pulls Klaviyo data every Sunday at 06:00 Israel time.

import cron from 'node-cron'

let isRunning = false
let scheduledTask: cron.ScheduledTask | null = null

export async function runDataPull(): Promise<void> {
  if (isRunning) {
    console.log('[scheduler] Pull already in progress, skipping.')
    return
  }
  isRunning = true
  console.log('[scheduler] Starting Klaviyo data pull…')
  try {
    const { runWeeklySync } = await import('@/lib/data-sync')
    const result = await runWeeklySync()
    console.log('[scheduler] Pull complete.', result)
  } catch (err) {
    console.error('[scheduler] Pull failed:', err)
  } finally {
    isRunning = false
  }
}

/**
 * Schedule: Every Sunday at 06:00 Asia/Jerusalem (Israel).
 * - Winter: 04:00 UTC
 * - Summer (DST): 03:00 UTC
 * node-cron handles DST automatically via the timezone option.
 */
export function startScheduler(): void {
  // Idempotent: stop any existing task before registering a new one
  if (scheduledTask) {
    scheduledTask.stop()
  }

  scheduledTask = cron.schedule(
    '0 6 * * 0', // 06:00 on Sunday (day 0 = Sunday)
    () => {
      console.log('[scheduler] Cron fired — weekly Sunday 06:00 IL pull.')
      runDataPull()
    },
    {
      timezone: 'Asia/Jerusalem',
    }
  )

  console.log('[scheduler] Weekly scheduler started: Sunday 06:00 Asia/Jerusalem')
}

export function getSchedulerStatus() {
  return {
    active: scheduledTask !== null,
    isRunning,
    cron: '0 6 * * 0',
    timezone: 'Asia/Jerusalem',
    description: 'Every Sunday at 06:00 Israel time',
  }
}
