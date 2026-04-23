import type { FlowSnapshot } from '@/types'

export interface AlertCounts {
  critical: number
  warning: number
  info: number
  totalMessages?: number  // # of emails in flow (for ratio-based penalty)
}

/**
 * Health score 0–100.
 * Weighted: deliverability (60%) + performance (40%) + alert penalty (up to -60)
 *
 * Deliverability factors (higher = worse → subtract from score):
 *   spam_complaint_rate > 0.2% → heavy penalty
 *   bounce_rate > 2%           → heavy penalty
 *   unsubscribe_rate > 1.5%    → moderate penalty
 *
 * Performance factors:
 *   open_rate  target ≥ 25%
 *   click_rate target ≥ 1%
 *
 * Alert penalty:
 *   Weighted alert count (critical×3 + warning×2 + info×1), scaled by
 *   the ratio of weighted alerts to total messages. If every message has
 *   a critical alert, the penalty hits -60.
 */
export function calcHealthScore(
  snap: Partial<FlowSnapshot> | null | undefined,
  alerts?: AlertCounts
): number {
  if (!snap) return 0
  let score = 100

  // --- Deliverability (60 pts) ---
  const spam = snap.spam_complaint_rate ?? 0
  const bounce = snap.bounce_rate ?? 0
  const unsub = snap.unsubscribe_rate ?? 0

  if (spam > 0.005) score -= 60
  else if (spam > 0.002) score -= 30
  else if (spam > 0.001) score -= 10

  if (bounce > 0.05) score -= 30
  else if (bounce > 0.02) score -= 15
  else if (bounce > 0.01) score -= 5

  if (unsub > 0.03) score -= 15
  else if (unsub > 0.015) score -= 10
  else if (unsub > 0.01) score -= 5

  // --- Performance (40 pts) ---
  const openRate = snap.open_rate ?? 0
  const clickRate = snap.click_rate ?? 0

  if (openRate < 0.1) score -= 20
  else if (openRate < 0.2) score -= 10
  else if (openRate < 0.25) score -= 5

  if (clickRate < 0.005) score -= 10
  else if (clickRate < 0.01) score -= 5

  // --- Alert penalty (up to -60) ---
  if (alerts) {
    const weighted = alerts.critical * 3 + alerts.warning * 2 + alerts.info * 1
    if (weighted > 0) {
      let penalty: number
      if (alerts.totalMessages && alerts.totalMessages > 0) {
        // Ratio-based: all messages having critical alerts = -60
        const maxWeighted = alerts.totalMessages * 3
        const ratio = Math.min(1, weighted / maxWeighted)
        penalty = Math.round(ratio * 60)
      } else {
        // Flat cap when message count unknown
        penalty = Math.min(60, weighted * 4)
      }
      // Minimum penalty of 3 when ANY alert exists
      score -= Math.max(3, penalty)
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function healthLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Healthy', color: 'green' }
  if (score >= 60) return { label: 'Fair', color: 'yellow' }
  if (score >= 40) return { label: 'Poor', color: 'orange' }
  return { label: 'Critical', color: 'red' }
}
