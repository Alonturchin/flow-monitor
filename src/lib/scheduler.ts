// Weekly cron scheduler — pulls Klaviyo data every Sunday at 06:00 Israel time.

import cron from 'node-cron'

const TASK_NAME = 'weekly-klaviyo-pull'
const CRON_EXPR = '0 6 * * 0' // 06:00 on day 0 (Sunday)
const TIMEZONE  = 'Asia/Jerusalem'

// Next bundles instrumentation.ts and route handlers separately, so each
// gets its own copy of this module AND its own copy of node-cron. To expose
// scheduler state across bundles, store it on globalThis (shared per
// Node process).
interface SchedulerState {
  started: boolean
  startedAt: number          // ms epoch
  isRunning: boolean
  lastRunAt: number | null   // ms epoch
  lastRunOk: boolean | null
  lastRunError: string | null
}

declare global {
  // eslint-disable-next-line no-var
  var __flowMonitorScheduler: SchedulerState | undefined
}

function state(): SchedulerState {
  if (!globalThis.__flowMonitorScheduler) {
    globalThis.__flowMonitorScheduler = {
      started: false,
      startedAt: 0,
      isRunning: false,
      lastRunAt: null,
      lastRunOk: null,
      lastRunError: null,
    }
  }
  return globalThis.__flowMonitorScheduler
}

export async function runDataPull(): Promise<void> {
  const s = state()
  if (s.isRunning) {
    console.log('[scheduler] Pull already in progress, skipping.')
    return
  }
  s.isRunning = true
  console.log('[scheduler] Starting Klaviyo data pull…')
  try {
    const { runWeeklySync } = await import('@/lib/data-sync')
    const result = await runWeeklySync()
    console.log('[scheduler] Pull complete.', result)
    s.lastRunAt = Date.now()
    s.lastRunOk = true
    s.lastRunError = null
  } catch (err) {
    console.error('[scheduler] Pull failed:', err)
    s.lastRunAt = Date.now()
    s.lastRunOk = false
    s.lastRunError = String(err)
  } finally {
    s.isRunning = false
  }
}

/**
 * Schedule: Every Sunday at 06:00 Asia/Jerusalem.
 * node-cron handles DST automatically via the timezone option.
 */
export function startScheduler(): void {
  const s = state()
  if (s.started) {
    console.log('[scheduler] Already started — skipping re-registration.')
    return
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

  s.started = true
  s.startedAt = Date.now()
  console.log('[scheduler] Weekly scheduler started: Sunday 06:00 Asia/Jerusalem')
}

/** Compute the next Sunday at 06:00 Asia/Jerusalem, returned as a UTC ISO string. */
function nextRunISO(): string {
  const now = new Date()
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
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const ilDayOfWeek = dayMap[part('weekday')] ?? 0

  let days: number
  if (ilDayOfWeek === 0 && (h < 6 || (h === 6 && mi === 0))) {
    days = 0
  } else {
    days = (7 - ilDayOfWeek) % 7
    if (days === 0) days = 7
  }

  const targetIlWall = new Date(Date.UTC(y, mo - 1, d + days, 6, 0, 0))
  const offsetMin = ilOffsetMinutes(targetIlWall)
  return new Date(targetIlWall.getTime() - offsetMin * 60_000).toISOString()
}

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
  const s = state()
  return {
    active: s.started,
    isRunning: s.isRunning,
    cron: CRON_EXPR,
    timezone: TIMEZONE,
    description: 'Every Sunday at 06:00 Israel time',
    startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
    lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
    lastRunOk: s.lastRunOk,
    lastRunError: s.lastRunError,
    nextRunUTC: nextRunISO(),
  }
}
