// Klaviyo REST API client
// All requests use server-side env vars — never import this in client components.

import type { Flow } from '@/types'

const KLAVIYO_BASE_URL = 'https://a.klaviyo.com/api'
const REVISION = '2024-10-15'

function getHeaders() {
  const apiKey = process.env.KLAVIYO_API_KEY
  if (!apiKey) throw new Error('KLAVIYO_API_KEY is not set')
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    revision: REVISION,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function klaviyoGet<T>(pathOrUrl: string, attempt = 0): Promise<T> {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${KLAVIYO_BASE_URL}${pathOrUrl}`
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' })
  if (res.status === 429 && attempt < 4) {
    const wait = parseInt(res.headers.get('Retry-After') ?? '2', 10) * 1000
    await sleep(wait)
    return klaviyoGet<T>(pathOrUrl, attempt + 1)
  }
  if (!res.ok) {
    throw new Error(`Klaviyo GET ${pathOrUrl} → ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

async function klaviyoPost<T>(path: string, body: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`${KLAVIYO_BASE_URL}${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (res.status === 429 && attempt < 4) {
    const wait = parseInt(res.headers.get('Retry-After') ?? '2', 10) * 1000
    await sleep(wait)
    return klaviyoPost<T>(path, body, attempt + 1)
  }
  if (!res.ok) {
    throw new Error(`Klaviyo POST ${path} → ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

// ─── Raw Klaviyo types ────────────────────────────────────────────────────────

interface KlaviyoPage<T> {
  data: T[]
  included?: unknown[]
  links: { next?: string | null }
}

interface KlaviyoFlowData {
  id: string
  type: 'flow'
  attributes: {
    name: string
    status: 'live' | 'draft' | 'archived' | 'manual'
    trigger_type: string | null
    created: string
    updated: string
    archived: boolean
  }
  relationships?: {
    tags?: { data: { id: string; type: 'tag' }[] }
  }
}

interface KlaviyoTagData {
  id: string
  type: 'tag'
  attributes: { name: string }
}

interface KlaviyoFlowActionData {
  id: string
  type: 'flow-action'
  attributes: {
    action_type: 'EMAIL' | 'SMS' | 'PUSH_NOTIFICATION' | 'DELAY' | 'CONDITIONAL_SPLIT' | 'ABSOLUTE_SPLIT' | 'EXTRACT' | string
    status: string
  }
  relationships?: {
    'flow-messages'?: { data: { id: string; type: string }[] }
  }
}

interface KlaviyoFlowMessageIncluded {
  id: string
  type: 'flow-message'
  attributes: { name: string }
}

interface KlaviyoMetricData {
  id: string
  type: 'metric'
  attributes: { name: string }
}

// ─── Flow listing ─────────────────────────────────────────────────────────────

export type NormalizedFlow = Flow

export async function listFlows(): Promise<NormalizedFlow[]> {
  const results: NormalizedFlow[] = []
  let url: string | null =
    `/flows?fields[flow]=name,status,trigger_type,created,updated,archived&include=tags&fields[tag]=name&page[size]=50`

  while (url) {
    const page = await klaviyoGet<KlaviyoPage<KlaviyoFlowData> & { included?: KlaviyoTagData[] }>(url)

    const tagMap = new Map<string, string>()
    for (const inc of page.included ?? []) {
      const t = inc as KlaviyoTagData
      if (t.type === 'tag') tagMap.set(t.id, t.attributes.name)
    }

    for (const flow of page.data) {
      const attrs = flow.attributes
      const status: Flow['status'] = attrs.archived
        ? 'archived'
        : attrs.status === 'live'
        ? 'live'
        : 'draft'

      const tags = (flow.relationships?.tags?.data ?? [])
        .map((t) => tagMap.get(t.id))
        .filter((t): t is string => !!t)

      results.push({
        flow_id: flow.id,
        name: attrs.name,
        status,
        trigger_type: attrs.trigger_type ?? null,
        tags,
        updated_at: attrs.updated,
      })
    }

    url = page.links?.next ?? null
  }

  return results
}

// ─── Flow messages ────────────────────────────────────────────────────────────

export interface FlowMessageInfo {
  message_id: string
  message_name: string
  flow_id: string
}

export async function listFlowMessages(flowId: string): Promise<FlowMessageInfo[]> {
  const results: FlowMessageInfo[] = []

  // Step 1: Get all flow-actions for this flow
  let url: string | null =
    `/flows/${flowId}/flow-actions?page[size]=50`

  const emailActionIds: string[] = []

  while (url) {
    const page = await klaviyoGet<KlaviyoPage<KlaviyoFlowActionData>>(url)

    for (const action of page.data) {
      if (action.attributes.action_type === 'SEND_EMAIL' || action.attributes.action_type === 'EMAIL') {
        emailActionIds.push(action.id)
      }
    }

    url = page.links?.next ?? null
  }

  // Step 2: Fetch flow-messages for each action — batch 3 at a time with small delays
  for (let i = 0; i < emailActionIds.length; i += 3) {
    const batch = emailActionIds.slice(i, i + 3)
    const settled = await Promise.allSettled(
      batch.map((actionId) =>
        klaviyoGet<KlaviyoPage<KlaviyoFlowMessageIncluded>>(
          `/flow-actions/${actionId}/flow-messages?fields[flow-message]=name`
        )
      )
    )
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        for (const msg of res.value.data) {
          results.push({
            message_id: msg.id,
            message_name: msg.attributes.name,
            flow_id: flowId,
          })
        }
      }
    }
    // Small delay between batches to avoid rate limits
    if (i + 3 < emailActionIds.length) await sleep(350)
  }

  return results
}

/** Lightweight: just get message names for a single flow (used by on-demand UI) */
export async function getFlowMessageNames(flowId: string): Promise<Map<string, string>> {
  const msgs = await listFlowMessages(flowId)
  const map = new Map<string, string>()
  for (const m of msgs) map.set(m.message_id, m.message_name)
  return map
}

// ─── Conversion metric ID discovery ──────────────────────────────────────────

const REVENUE_METRIC_CANDIDATES = ['Placed Order', 'Ordered Product', 'Checkout Started']

let cachedConversionMetricId: string | null = null

export async function getConversionMetricId(): Promise<string | null> {
  if (cachedConversionMetricId) return cachedConversionMetricId

  let url: string | null = `/metrics?fields[metric]=name`

  while (url) {
    const page = await klaviyoGet<KlaviyoPage<KlaviyoMetricData>>(url)

    for (const metric of page.data) {
      if (REVENUE_METRIC_CANDIDATES.includes(metric.attributes.name)) {
        console.log(`[klaviyo] Conversion metric "${metric.attributes.name}" → ${metric.id}`)
        cachedConversionMetricId = metric.id
        return cachedConversionMetricId
      }
    }

    url = page.links?.next ?? null
  }

  console.warn('[klaviyo] No conversion metric found. Revenue data will be unavailable.')
  return null
}

// ─── Flow Values Report (Reporting API) ──────────────────────────────────────
// Uses POST /flow-values-reports to get all flow + message stats in one call.
// This is the correct endpoint for revenue (conversion_value).

interface FlowValuesReportResponse {
  data: {
    type: string
    attributes: {
      results: Array<{
        groupings: {
          flow_id: string
          flow_message_id: string
          send_channel: string
        }
        statistics: Record<string, number>
      }>
    }
  }
  links?: { next?: string | null }
}

export interface FlowStats {
  flow_id: string
  recipients: number
  opens: number
  clicks: number
  unsubscribes: number
  bounces: number
  spam_complaints: number
  revenue: number
  // Rates from Klaviyo (weighted by message; will be recalculated in sync)
  open_rate: number | null
  click_rate: number | null
  bounce_rate: number | null
  unsubscribe_rate: number | null
  spam_complaint_rate: number | null
  revenue_per_recipient: number | null
}

export interface MessageReportRow {
  flow_id: string
  message_id: string
  recipients: number
  opens: number
  clicks: number
  unsubscribes: number
  bounces: number
  spam_complaints: number
  revenue: number
  open_rate: number | null
  click_rate: number | null
  bounce_rate: number | null
  unsubscribe_rate: number | null
  spam_complaint_rate: number | null
  revenue_per_recipient: number | null
}

export interface FlowReportResult {
  flowStats: Map<string, FlowStats>
  messageStats: Map<string, MessageReportRow>
}

export async function getFlowReport(
  weekStart: Date,
  weekEnd: Date
): Promise<FlowReportResult> {
  const conversionMetricId = await getConversionMetricId()

  const body = {
    data: {
      type: 'flow-values-report',
      attributes: {
        timeframe: {
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
        },
        ...(conversionMetricId && { conversion_metric_id: conversionMetricId }),
        statistics: [
          'recipients',
          'opens_unique',
          'clicks_unique',
          'bounced',
          'unsubscribes',
          'spam_complaints',
          'conversion_value',
          'open_rate',
          'click_rate',
          'bounce_rate',
          'unsubscribe_rate',
          'spam_complaint_rate',
          'revenue_per_recipient',
        ],
      },
    },
  }

  console.log('[klaviyo] Querying flow-values-report…')

  // First page via POST
  const firstResult = await klaviyoPost<FlowValuesReportResponse>('/flow-values-reports', body)
  const allRows = [...(firstResult.data?.attributes?.results ?? [])]

  // Follow pagination — extract page_cursor from next URL and re-POST with it
  let nextUrl = firstResult.links?.next ?? null
  let pageNum = 1
  while (nextUrl) {
    pageNum++
    console.log(`[klaviyo] flow-values-report page ${pageNum}…`)
    const cursor = new URL(nextUrl).searchParams.get('page[cursor]')
    if (!cursor) break
    const nextResult = await klaviyoPost<FlowValuesReportResponse>(
      `/flow-values-reports?page%5Bcursor%5D=${encodeURIComponent(cursor)}`,
      body
    )
    allRows.push(...(nextResult.data?.attributes?.results ?? []))
    nextUrl = nextResult.links?.next ?? null
  }

  console.log(`[klaviyo] flow-values-report returned ${allRows.length} rows across ${pageNum} page(s)`)

  const flowStatsMap = new Map<string, FlowStats>()
  const messageStatsMap = new Map<string, MessageReportRow>()

  for (const row of allRows) {
    const { flow_id, flow_message_id } = row.groupings
    const s = row.statistics

    // ── Message-level stats ──
    if (flow_message_id) {
      messageStatsMap.set(flow_message_id, {
        flow_id,
        message_id: flow_message_id,
        recipients: s.recipients ?? 0,
        opens: s.opens_unique ?? 0,
        clicks: s.clicks_unique ?? 0,
        unsubscribes: s.unsubscribes ?? 0,
        bounces: s.bounced ?? 0,
        spam_complaints: s.spam_complaints ?? 0,
        revenue: s.conversion_value ?? 0,
        open_rate: s.open_rate ?? null,
        click_rate: s.click_rate ?? null,
        bounce_rate: s.bounce_rate ?? null,
        unsubscribe_rate: s.unsubscribe_rate ?? null,
        spam_complaint_rate: s.spam_complaint_rate ?? null,
        revenue_per_recipient: s.revenue_per_recipient ?? null,
      })
    }

    // ── Aggregate to flow-level ──
    const existing = flowStatsMap.get(flow_id)
    if (existing) {
      existing.recipients += s.recipients ?? 0
      existing.opens += s.opens_unique ?? 0
      existing.clicks += s.clicks_unique ?? 0
      existing.unsubscribes += s.unsubscribes ?? 0
      existing.bounces += s.bounced ?? 0
      existing.spam_complaints += s.spam_complaints ?? 0
      existing.revenue += s.conversion_value ?? 0
    } else {
      flowStatsMap.set(flow_id, {
        flow_id,
        recipients: s.recipients ?? 0,
        opens: s.opens_unique ?? 0,
        clicks: s.clicks_unique ?? 0,
        unsubscribes: s.unsubscribes ?? 0,
        bounces: s.bounced ?? 0,
        spam_complaints: s.spam_complaints ?? 0,
        revenue: s.conversion_value ?? 0,
        open_rate: null,
        click_rate: null,
        bounce_rate: null,
        unsubscribe_rate: null,
        spam_complaint_rate: null,
        revenue_per_recipient: null,
      })
    }
  }

  // Recalculate flow-level rates from aggregated counts
  for (const stats of flowStatsMap.values()) {
    const r = stats.recipients
    if (r > 0) {
      stats.open_rate = stats.opens / r
      stats.click_rate = stats.clicks / r
      stats.bounce_rate = stats.bounces / r
      stats.unsubscribe_rate = stats.unsubscribes / r
      stats.spam_complaint_rate = stats.spam_complaints / r
      stats.revenue_per_recipient = stats.revenue / r
    }
  }

  return { flowStats: flowStatsMap, messageStats: messageStatsMap }
}

export { klaviyoGet }
