// Weekly cron scheduler — pulls Klaviyo data every Sunday at 06:00 Israel time.

import cron from 'node-cron'

const TASK_NAME = 'weekly-klaviyo-pull'
const CRON_EXPR = '0 6 * * 0' // 06:00 on day 0 (Sunday)
const TIMEZONE  = 'Asia/Jerusalem'

let isRunning = false

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
 * Schedule: Every Sunday at 06:00 Asia/Jerusalem.
 * node-cron handles DST automatically via the timezone option.
 *
 * Status is read back via cron.getTasks() so it works correctly even when
 * Next bundles instrumentation.ts and the route handler into separate
 * module instances (the underlying node-cron module is a singleton).
 */
export function startScheduler(): void {
  const existing = cron.getTasks().get(TASK_NAME)
  if (existing) {
    existing.stop()
  }

  cron.schedule(
    CRON_EXPR,
    () => {
      console.log('[scheduler] Cron fired — weekly Sunday 06:00 IL pull.')
      runDataPull()
    },
    {
      name: TASK_NAME,
      timezone: TIMEZONE,
    }
  )

  console.log('[scheduler] Weekly scheduler started: Sunday 06:00 Asia/Jerusalem')
}

/** Compute the next Sunday at 06:00 Asia/Jerusalem, returned as a UTC ISO string. */
function nextRunISO(): string {
  const now = new Date()
  // Format current time as if in IL — using sv-SE locale which is YYYY-MM-DD HH:mm:ss
  const ilParts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)

  const part = (k: string) => ilParts.find(p => p.type === k)?.value ?? ''
  const y = Number(part('year'))
  const mo = Number(part('month'))
  const d = Number(part('day'))
  const h = Number(part('hour'))
  const mi = Number(part('minute'))
  const weekdayShort = part('weekday') // e.g. 'Mon'
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const ilDayOfWeek = dayMap[weekdayShort] ?? 0

  // Days until next Sunday 06:00 IL
  let days: number
  if (ilDayOfWeek === 0 && (h < 6 || (h === 6 && mi === 0))) {
    days = 0
  } else {
    days = (7 - ilDayOfWeek) % 7
    if (days === 0) days = 7
  }

  // Build target IL wall time, then convert to UTC by computing the IL offset for that moment.
  // Strategy: build a UTC date with the IL wall-clock numbers, then subtract IL offset.
  const targetIlWall = new Date(Date.UTC(y, mo - 1, d + days, 6, 0, 0))
  // Compute IL offset for that target by looking at how IL formats it.
  const offsetMin = ilOffsetMinutes(targetIlWall)
  const targetUTC = new Date(targetIlWall.getTime() - offsetMin * 60_000)
  return targetUTC.toISOString()
}

/** Offset of Asia/Jerusalem from UTC, in minutes, at the given instant. */
function ilOffsetMinutes(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const parts = fmt.formatToParts(at)
  const part = (k: string) => parts.find(p => p.type === k)?.value ?? '0'
  const ilAsUtc = Date.UTC(
    Number(part('year')), Number(part('month')) - 1, Number(part('day')),
    Number(part('hour')), Number(part('minute')), Number(part('second')),
  )
  return Math.round((ilAsUtc - at.getTime()) / 60_000)
}

export function getSchedulerStatus() {
  const tasks = cron.getTasks()
  const ourTask = tasks.get(TASK_NAME)
  return {
    active: !!ourTask,
    isRunning,
    cron: CRON_EXPR,
    timezone: TIMEZONE,
    description: 'Every Sunday at 06:00 Israel time',
    nextRunUTC: nextRunISO(),
    totalRegisteredTasks: tasks.size,
  }
}
