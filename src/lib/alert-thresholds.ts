// Shared threshold types and defaults — safe to import in both server and client code.

export interface AlertThresholds {
  spam_critical:   number
  spam_warning:    number
  bounce_critical: number
  bounce_warning:  number
  unsub_warning:   number
  unsub_info:      number
  open_critical:   number
  open_info:       number
  click_info:      number
  min_recipients:  number
  // Revenue-drop alerts (week-over-week)
  revenue_drop_warning:  number  // e.g. 0.25 = fire warning when revenue drops 25%+
  revenue_drop_critical: number  // e.g. 0.50 = fire critical when revenue drops 50%+
  revenue_drop_min:      number  // minimum prior-week revenue ($) to check
  // Open-rate drop alerts (complement to the absolute open_rate thresholds above)
  open_drop_warning:     number  // e.g. 0.20 = warning when open rate drops 20%+
  open_drop_critical:    number  // e.g. 0.40 = critical when open rate drops 40%+
  // Click-rate drop alerts (only drop detection — no absolute threshold because it varies by flow)
  click_drop_warning:    number
  click_drop_critical:   number
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  spam_critical:   0.005,
  spam_warning:    0.002,
  bounce_critical: 0.05,
  bounce_warning:  0.02,
  unsub_warning:   0.03,
  unsub_info:      0.015,
  open_critical:   0.10,
  open_info:       0.25,
  click_info:      0.01,
  min_recipients:  500,
  revenue_drop_warning:  0.25,
  revenue_drop_critical: 0.50,
  revenue_drop_min:      100,
  open_drop_warning:     0.20,
  open_drop_critical:    0.40,
  click_drop_warning:    0.25,
  click_drop_critical:   0.50,
}
