interface MetricCardProps {
  label: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  trendGoodDirection?: 'up' | 'down'
}

function MetricCard({ label, value, sub, trend, trendValue, trendGoodDirection = 'up' }: MetricCardProps) {
  const trendColor =
    !trend || trend === 'neutral'
      ? 'text-gray-400'
      : trend === trendGoodDirection
      ? 'text-green-600'
      : 'text-red-600'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {(trendValue || sub) && (
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          {trend && trendValue && (
            <span className={`text-xs font-medium ${trendColor}`}>
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '–'} {trendValue}
            </span>
          )}
          {sub && <span className="text-xs text-gray-400">{sub}</span>}
        </div>
      )}
    </div>
  )
}

interface MetricCardsProps {
  totalRevenue?: number
  prevRevenue?: number
  flowsMonitored?: number
  liveFlowCount?: number
  activeAlerts?: number
  criticalAlerts?: number
  warningAlerts?: number
  avgOpenRate?: number
  prevOpenRate?: number
  compareMode?: 'none' | 'prev_period' | 'prev_year'
}

const COMPARE_LABEL: Record<string, string> = {
  prev_period: 'vs prev period',
  prev_year: 'vs prev year',
}

export default function MetricCards({
  totalRevenue = 0,
  prevRevenue,
  flowsMonitored = 0,
  liveFlowCount,
  activeAlerts = 0,
  criticalAlerts = 0,
  warningAlerts = 0,
  avgOpenRate = 0,
  prevOpenRate,
  compareMode = 'none',
}: MetricCardsProps) {
  const formatCurrency = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
      ? `$${(n / 1000).toFixed(1)}k`
      : `$${n.toFixed(0)}`

  const showCompare = compareMode !== 'none'
  const compareLabel = COMPARE_LABEL[compareMode] ?? ''

  // Revenue trend
  const hasRevCompare = showCompare && prevRevenue != null
  const revTrend: 'up' | 'down' | 'neutral' =
    !hasRevCompare || prevRevenue === 0
      ? totalRevenue > 0 && showCompare ? 'up' : 'neutral'
      : totalRevenue > prevRevenue!
      ? 'up'
      : totalRevenue < prevRevenue!
      ? 'down'
      : 'neutral'
  const revDelta = !showCompare
    ? undefined
    : prevRevenue != null && prevRevenue > 0
    ? `${Math.abs(((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1)}% ${compareLabel}`
    : `${compareLabel}`

  // Open rate trend
  const hasOpenCompare = showCompare && prevOpenRate != null
  const openTrend: 'up' | 'down' | 'neutral' =
    !hasOpenCompare || prevOpenRate === 0
      ? 'neutral'
      : avgOpenRate > prevOpenRate!
      ? 'up'
      : avgOpenRate < prevOpenRate!
      ? 'down'
      : 'neutral'
  const openDelta = !showCompare
    ? undefined
    : prevOpenRate != null && prevOpenRate > 0
    ? `${Math.abs(((avgOpenRate - prevOpenRate) / prevOpenRate) * 100).toFixed(1)}% ${compareLabel}`
    : `${compareLabel}`

  // Alert sub-text
  const alertSub =
    activeAlerts === 0
      ? 'all clear'
      : [
          criticalAlerts > 0 ? `${criticalAlerts} critical` : '',
          warningAlerts > 0 ? `${warningAlerts} warning${warningAlerts !== 1 ? 's' : ''}` : '',
        ]
          .filter(Boolean)
          .join(' · ')

  // Flows sub-text
  const flowsSub = liveFlowCount != null ? `${liveFlowCount} total live` : 'live flows'

  return (
    <div className="grid grid-cols-4 gap-4">
      <MetricCard
        label="Total Revenue"
        value={formatCurrency(totalRevenue)}
        trend={revTrend}
        trendValue={revDelta}
        trendGoodDirection="up"
        sub={showCompare ? undefined : 'last snapshot'}
      />
      <MetricCard
        label="Flows Monitored"
        value={flowsMonitored.toString()}
        sub={flowsSub}
      />
      <MetricCard
        label="Active Alerts"
        value={activeAlerts.toString()}
        sub={alertSub}
      />
      <MetricCard
        label="Avg Open Rate"
        value={avgOpenRate > 0 ? `${(avgOpenRate * 100).toFixed(1)}%` : '—'}
        trend={openTrend}
        trendValue={openDelta}
        trendGoodDirection="up"
        sub={showCompare ? undefined : 'across all flows'}
      />
    </div>
  )
}
