// Auto-runs when the Next.js server starts.
// Registers the weekly cron job for pulling Klaviyo data.

export async function register() {
  // Only run on server runtime (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler')
    startScheduler()
  }
}
