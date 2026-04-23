// Core domain types for Flow Monitor

export interface Flow {
  flow_id: string
  name: string
  tags: string[]
  status: 'live' | 'draft' | 'archived'
  trigger_type: string | null
  updated_at: string
}

export interface FlowSnapshot {
  id: number
  flow_id: string
  week_start: string
  recipients: number
  open_rate: number | null
  click_rate: number | null
  unsubscribe_rate: number | null
  spam_complaint_rate: number | null
  bounce_rate: number | null
  conversion_rate: number | null
  revenue: number | null
  revenue_per_recipient: number | null
  created_at: string
}

export interface MessageSnapshot {
  id: number
  flow_id: string
  message_id: string
  message_name: string | null
  week_start: string
  recipients: number
  open_rate: number | null
  click_rate: number | null
  unsubscribe_rate: number | null
  spam_complaint_rate: number | null
  bounce_rate: number | null
  conversion_rate: number | null
  revenue: number | null
  revenue_per_recipient: number | null
  created_at: string
}

export type AlertSeverity = 'critical' | 'warning' | 'info'

export interface Alert {
  id: number
  flow_id: string
  message_id: string | null
  severity: AlertSeverity
  metric: string
  value: number
  threshold: number
  ai_suggestion: string | null
  monday_task_id: string | null
  created_at: string
  resolved_at: string | null
}

export type AbTestStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed'

export interface AbTest {
  id: number
  flow_id: string
  message_id: string | null
  hypothesis: string
  suggested_change: string
  metric_to_watch: string
  confidence: number
  status: AbTestStatus
  result: string | null
  created_at: string
  updated_at: string
}

// Alert thresholds (used by Phase 4 alert engine)
export const ALERT_THRESHOLDS = {
  spam_complaint_rate: 0.002,   // > 0.2%
  bounce_rate: 0.02,            // > 2%
  unsubscribe_rate: 0.015,      // > 1.5%
  open_rate_min: 0.25,          // < 25%
  click_rate_min: 0.01,         // < 1% (for 500+ recipients)
  min_recipients_for_alert: 500,
} as const
