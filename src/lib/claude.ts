// Claude AI client — flow analysis and alert suggestions.
// Server-side only.

import Anthropic from '@anthropic-ai/sdk'
import type { Flow, FlowSnapshot } from '@/types'
import type { AlertWithFlow } from '@/lib/alert-engine'

// Analysis model — Sonnet is better at synthesizing trends + web search results.
// Haiku is used for lighter-weight tasks (metric drops, simple suggestions).
const ANALYSIS_MODEL = 'claude-sonnet-4-6'
const LIGHT_MODEL    = 'claude-haiku-4-5-20251001'

// Web search tool — Anthropic executes it server-side, no loop needed.
// max_uses kept at 1 to keep input tokens predictable (each search result
// can add a few thousand tokens to the request context).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WEB_SEARCH_TOOL: any = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 1,
}

/** Retry wrapper for transient 429 rate-limit hits. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const e = err as { status?: number; headers?: Record<string, string> }
      if (e?.status !== 429 || i === attempts - 1) throw err
      // Honor server-sent retry-after when present, else exponential backoff.
      const retryAfterSec = Number(e.headers?.['retry-after'])
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(1000 * Math.pow(2, i), 30_000)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

/** Extract all text blocks from a response (skip tool_use / tool_result blocks). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectText(content: any[]): string {
  return content
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function fmtPct(n: number | null | undefined) {
  return n != null ? `${(Number(n) * 100).toFixed(2)}%` : 'n/a'
}

// ─── Flow analysis ────────────────────────────────────────────────────────────

export interface FlowAnalysisInput {
  flow: Pick<Flow, 'name' | 'status' | 'trigger_type' | 'tags'>
  snapshot: Partial<FlowSnapshot> | null
  alerts: Pick<AlertWithFlow, 'severity' | 'metric' | 'value' | 'threshold'>[]
  healthScore: number
}

export async function analyzeFlow(input: FlowAnalysisInput): Promise<string> {
  const { flow, snapshot, alerts, healthScore } = input

  const snap = snapshot ?? {}
  const alertLines = alerts.length
    ? alerts.map((a) =>
        `- ${a.severity.toUpperCase()}: ${a.metric} = ${fmtPct(a.value)} (threshold ${fmtPct(a.threshold)})`
      ).join('\n')
    : '- None'

  const prompt = `You are an email marketing analyst reviewing a Klaviyo retention flow.

Flow: "${flow.name}"
Type: ${flow.trigger_type ?? 'unknown'} | Status: ${flow.status}
Tags: ${flow.tags?.join(', ') || 'none'}
Health score: ${healthScore}/100

Last 7-day metrics:
- Recipients: ${snap.recipients?.toLocaleString() ?? 'n/a'}
- Open rate: ${fmtPct(snap.open_rate)} (benchmark: 25%+)
- Click rate: ${fmtPct(snap.click_rate)} (benchmark: 1%+)
- Unsubscribe rate: ${fmtPct(snap.unsubscribe_rate)} (threshold: 1.5%)
- Bounce rate: ${fmtPct(snap.bounce_rate)} (threshold: 2%)
- Spam complaint rate: ${fmtPct(snap.spam_complaint_rate)} (threshold: 0.2%)
- Revenue attributed: ${snap.revenue != null ? `$${Number(snap.revenue).toLocaleString()}` : 'not tracked'}

Active alerts:
${alertLines}

Write a concise diagnostic (3–5 sentences max). Cover:
1. The most critical issue (if any)
2. One specific, actionable recommendation
3. Any positive signal worth noting

Be direct and specific. No preamble.`

  const msg = await getClient().messages.create({
    model: LIGHT_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  return collectText(msg.content)
}

// ─── Per-alert analysis + chat ───────────────────────────────────────────────

export interface AlertAnalysisInput {
  flow: Pick<Flow, 'name' | 'status' | 'trigger_type' | 'tags'>
  alert: {
    metric: string
    value: number
    threshold: number
    severity: string
    message_name: string | null
    message_id: string | null
  }
  messageStats: Partial<FlowSnapshot> | null  // stats for the affected message (if any)
  flowStats: Partial<FlowSnapshot> | null     // flow-level stats
  weekStart: string | null
  historicalSnapshots?: (Partial<FlowSnapshot> & { week_start?: string })[]  // up to 12 prior weeks (most recent first)
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function buildAlertContext(input: AlertAnalysisInput): string {
  const { flow, alert, messageStats, flowStats, weekStart, historicalSnapshots } = input
  const scope = alert.message_name
    ? `Email "${alert.message_name}" inside flow "${flow.name}"`
    : `Entire flow "${flow.name}"`

  const stats = messageStats ?? flowStats ?? {}
  const weekText = weekStart ? `Week of ${weekStart}` : 'Latest week'

  // Build trend lines from historical data (oldest first = chronological)
  const history = (historicalSnapshots ?? []).slice().reverse()
  const trendLines = history.length > 0
    ? history.map((h) =>
        `  ${h.week_start ?? '?'}: recipients ${h.recipients?.toLocaleString() ?? 'n/a'}, opens ${fmtPct(h.open_rate)}, clicks ${fmtPct(h.click_rate)}, bounces ${fmtPct(h.bounce_rate)}, spam ${fmtPct(h.spam_complaint_rate)}, revenue $${Number(h.revenue ?? 0).toLocaleString()}`
      ).join('\n')
    : '  (no prior weeks available)'

  return `You are a Klaviyo retention marketing analyst. You are reviewing a specific alert.

${weekText} — ${scope}
Flow trigger: ${flow.trigger_type ?? 'unknown'} | Status: ${flow.status}
Tags: ${flow.tags?.join(', ') || 'none'}

Alert:
- Severity: ${alert.severity}
- Metric: ${alert.metric}
- Current value: ${alert.metric === 'revenue_drop' || alert.metric === 'open_rate_drop' || alert.metric === 'click_rate_drop' ? `${(alert.value * 100).toFixed(1)}% drop` : fmtPct(alert.value)}
- Threshold: ${alert.metric === 'revenue_drop' || alert.metric === 'open_rate_drop' || alert.metric === 'click_rate_drop' ? `${(alert.threshold * 100).toFixed(0)}%+ drop` : fmtPct(alert.threshold)}

Current week stats:
- Recipients: ${stats.recipients?.toLocaleString() ?? 'n/a'}
- Open rate: ${fmtPct(stats.open_rate)}
- Click rate: ${fmtPct(stats.click_rate)}
- Bounce rate: ${fmtPct(stats.bounce_rate)}
- Unsub rate: ${fmtPct(stats.unsubscribe_rate)}
- Spam rate: ${fmtPct(stats.spam_complaint_rate)}
- Revenue: ${stats.revenue != null ? `$${Number(stats.revenue).toLocaleString()}` : 'n/a'}

Historical trend (oldest → newest, up to 6 prior weeks):
${trendLines}

Use the historical data to identify patterns:
- Is this a sudden change or a gradual decline?
- Is this a one-off anomaly or consistent with recent weeks?
- Are there seasonal patterns?
- How does the current metric compare to the long-term average?

Give a focused, actionable diagnostic. Reference specific numbers from the trend when relevant. Cover:
1. Pattern analysis (sudden vs gradual, anomaly vs trend)
2. Why this might be happening (likely root causes)
3. What to check first
4. Concrete recommended action
Answer in 4-6 sentences. Be direct — no preamble.`
}

export async function analyzeAlert(input: AlertAnalysisInput): Promise<string> {
  const prompt = buildAlertContext(input) + `

You have access to web search. Use it (up to 3 searches) to find:
- Current email marketing benchmarks for this metric and flow type
- Specific fixes others have used for this exact issue
- Best practices from recent blog posts / Klaviyo's own guides

Cite the source URL briefly when you use a web-sourced insight.`

  const msg = await withRateLimitRetry(() =>
    getClient().messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1000,
      tools: [WEB_SEARCH_TOOL],
      messages: [{ role: 'user', content: prompt }],
    })
  )
  return collectText(msg.content)
}

/**
 * Continue a conversation about an alert.
 * Pass the initial system context + prior messages + new user question.
 */
export async function chatAboutAlert(
  input: AlertAnalysisInput,
  history: ChatMessage[]
): Promise<string> {
  const systemContext = buildAlertContext(input) + `

You have access to web search. Use it when the user asks about benchmarks, best practices, industry standards, or when citing an outside source would make your answer more authoritative. Cite URLs briefly.`

  const msg = await withRateLimitRetry(() =>
    getClient().messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1200,
      tools: [WEB_SEARCH_TOOL],
      system: systemContext,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    })
  )
  return collectText(msg.content)
}

// ─── A/B test suggestions ─────────────────────────────────────────────────────

export interface AbTestSuggestion {
  hypothesis: string
  suggested_change: string
  metric_to_watch: string
  confidence: number
  rationale?: string       // WHY this test is suggested (based on metrics)
  expected_impact?: string // e.g. "+10-20% open rate"
}

export interface MessageTestInput {
  flow: Pick<Flow, 'name' | 'status' | 'trigger_type' | 'tags'>
  messageName: string | null
  messageId: string
  currentStats: Partial<FlowSnapshot> | null          // latest week's snapshot
  historicalStats?: Partial<FlowSnapshot>[]           // prior weeks (for trend analysis)
  activeAlerts: Pick<AlertWithFlow, 'severity' | 'metric' | 'value' | 'threshold'>[]
  avoidHypotheses?: string[]  // hypotheses from previous regens to avoid repeating
}

function buildTestContext(input: MessageTestInput): string {
  const { flow, messageName, currentStats, historicalStats, activeAlerts, avoidHypotheses } = input

  const cur = currentStats ?? {}
  const trendLines = historicalStats && historicalStats.length > 0
    ? historicalStats.map((h, i) =>
        `  Week ${historicalStats.length - i} ago: opens ${fmtPct(h.open_rate)}, clicks ${fmtPct(h.click_rate)}, bounces ${fmtPct(h.bounce_rate)}, spam ${fmtPct(h.spam_complaint_rate)}, rev $${Number(h.revenue ?? 0).toLocaleString()}`
      ).join('\n')
    : '  (not available)'

  const alertLines = activeAlerts.length > 0
    ? activeAlerts.map(a => `  - ${a.severity}: ${a.metric} = ${fmtPct(a.value)} (threshold ${fmtPct(a.threshold)})`).join('\n')
    : '  (none)'

  const avoid = avoidHypotheses && avoidHypotheses.length > 0
    ? `\nDo NOT repeat these hypotheses from earlier suggestions:\n${avoidHypotheses.map(h => `- ${h}`).join('\n')}\nSuggest DIFFERENT tests that explore other angles.`
    : ''

  return `You are a Klaviyo email CRO specialist. Suggest A/B tests for a specific email.

Email: "${messageName ?? 'Untitled'}" inside flow "${flow.name}"
Flow type: ${flow.trigger_type ?? 'unknown'} | Tags: ${flow.tags?.join(', ') || 'none'}

Current week stats:
- Recipients: ${cur.recipients?.toLocaleString() ?? 'n/a'}
- Open rate: ${fmtPct(cur.open_rate)}
- Click rate: ${fmtPct(cur.click_rate)}
- Bounce rate: ${fmtPct(cur.bounce_rate)}
- Unsubscribe rate: ${fmtPct(cur.unsubscribe_rate)}
- Spam rate: ${fmtPct(cur.spam_complaint_rate)}
- Revenue: $${Number(cur.revenue ?? 0).toLocaleString()}

Historical trend (oldest first):
${trendLines}

Active alerts on this email:
${alertLines}
${avoid}`
}

/**
 * Suggest A/B tests for a specific message, grounded in real metrics and trends.
 * Each suggestion includes a rationale referencing actual numbers.
 */
export async function suggestTestsForMessage(input: MessageTestInput): Promise<AbTestSuggestion[]> {
  const context = buildTestContext(input)
  const instruction = `
Return a JSON array only (no prose, no code fences) in this exact format:
[
  {
    "hypothesis": "If we X, then Y will improve because Z",
    "rationale": "Reference SPECIFIC numbers from the data above. e.g. 'Open rate dropped from 35% to 22% over 4 weeks while subject lines remained identical.'",
    "suggested_change": "Concrete change to make (e.g. 'Test 3 new subject line variants focused on urgency')",
    "metric_to_watch": "open_rate|click_rate|unsubscribe_rate|bounce_rate|revenue",
    "expected_impact": "+X-Y% on the watched metric",
    "confidence": 0.65
  }
]

Provide 2–3 tests. Each should:
1. Be specific to THIS email's actual metrics (not generic)
2. Have a clear, data-backed rationale
3. Be feasibly testable in a week or two

You may use web search (up to 3 searches) to ground your suggestions in recent best practices or industry examples.`

  const msg = await withRateLimitRetry(() =>
    getClient().messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1800,
      tools: [WEB_SEARCH_TOOL],
      messages: [{ role: 'user', content: context + instruction }],
    })
  )

  const text = collectText(msg.content)
  if (!text) return []

  try {
    const match = text.match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) as AbTestSuggestion[] : []
  } catch {
    return []
  }
}

/**
 * Chat about an email's A/B tests — follow-up Q&A.
 * `history` is the full conversation so far.
 */
export async function chatAboutTests(
  input: MessageTestInput,
  history: ChatMessage[]
): Promise<string> {
  const systemContext = buildTestContext(input) + `

You are advising on A/B tests for this email. Be specific, cite actual numbers when possible, and suggest practical, testable changes.

You have access to web search. Use it when the user asks about benchmarks, proven test patterns, or industry standards. Cite URLs briefly.`
  const msg = await withRateLimitRetry(() =>
    getClient().messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1200,
      tools: [WEB_SEARCH_TOOL],
      system: systemContext,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    })
  )
  return collectText(msg.content)
}

export async function generateAbTests(input: FlowAnalysisInput): Promise<AbTestSuggestion[]> {
  const { flow, snapshot, healthScore } = input
  const snap = snapshot ?? {}

  const prompt = `You are an email CRO specialist. Suggest 2–3 A/B tests for this Klaviyo flow.

Flow: "${flow.name}" | Health: ${healthScore}/100
Open rate: ${fmtPct(snap.open_rate)} | Click rate: ${fmtPct(snap.click_rate)}
Unsubscribe rate: ${fmtPct(snap.unsubscribe_rate)} | Bounce rate: ${fmtPct(snap.bounce_rate)}

Return a JSON array only (no prose) in this exact format:
[
  {
    "hypothesis": "If we X, then Y will improve because Z",
    "suggested_change": "Specific change to make",
    "metric_to_watch": "open_rate|click_rate|unsubscribe_rate|revenue",
    "confidence": 0.7
  }
]`

  const msg = await getClient().messages.create({
    model: LIGHT_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = collectText(msg.content)
  if (!text) return []

  try {
    const match = text.match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) as AbTestSuggestion[] : []
  } catch {
    return []
  }
}
