'use client'

import TopBar from '@/components/layout/TopBar'

export default function InfoPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Info & documentation" subtitle="How the app works" />
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl space-y-10">

        {/* Health Score */}
        <section>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Health Score</h1>
          <p className="text-sm text-gray-600 mb-4">
            Every flow starts at <span className="font-semibold">100</span> and gets penalties deducted.
            The final score is clamped to 0–100.
          </p>

          {/* Label thresholds */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-900">Labels</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {[
                  { range: '80–100', label: 'Healthy', dot: 'bg-green-500', color: 'text-green-700' },
                  { range: '60–79',  label: 'Fair',    dot: 'bg-yellow-400', color: 'text-yellow-700' },
                  { range: '40–59',  label: 'Poor',    dot: 'bg-orange-500', color: 'text-orange-700' },
                  { range: '< 40',   label: 'Critical', dot: 'bg-red-500', color: 'text-red-700' },
                ].map((r) => (
                  <tr key={r.label} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-2.5 w-24 text-gray-600">{r.range}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${r.dot}`} />
                        <span className={`font-medium ${r.color}`}>{r.label}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Deliverability */}
          <h2 className="text-base font-semibold text-gray-900 mb-2">1. Deliverability penalties</h2>
          <p className="text-xs text-gray-500 mb-3">
            Higher rates = worse inbox placement. Each metric has tiered penalties.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            <MetricCard
              title="Spam complaint rate"
              rows={[
                { label: '> 0.5%', penalty: '−60', note: 'catastrophic' },
                { label: '> 0.2%', penalty: '−30' },
                { label: '> 0.1%', penalty: '−10' },
              ]}
            />
            <MetricCard
              title="Bounce rate"
              rows={[
                { label: '> 5%', penalty: '−30' },
                { label: '> 2%', penalty: '−15' },
                { label: '> 1%', penalty: '−5' },
              ]}
            />
            <MetricCard
              title="Unsubscribe rate"
              rows={[
                { label: '> 3%',   penalty: '−15' },
                { label: '> 1.5%', penalty: '−10' },
                { label: '> 1%',   penalty: '−5' },
              ]}
            />
          </div>

          {/* Performance */}
          <h2 className="text-base font-semibold text-gray-900 mb-2">2. Performance penalties</h2>
          <p className="text-xs text-gray-500 mb-3">
            Lower rates = weaker engagement. Open rate has absolute thresholds; click rate is handled by drop detection (see below).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <MetricCard
              title="Open rate"
              rows={[
                { label: '< 10%', penalty: '−20' },
                { label: '< 20%', penalty: '−10' },
                { label: '< 25%', penalty: '−5' },
              ]}
            />
            <MetricCard
              title="Click rate"
              rows={[
                { label: '< 0.5%', penalty: '−10' },
                { label: '< 1%',   penalty: '−5' },
              ]}
            />
          </div>

          {/* Alert penalty */}
          <h2 className="text-base font-semibold text-gray-900 mb-2">3. Alert penalty</h2>
          <p className="text-sm text-gray-600 mb-2">
            For each flow, active alerts are weighted by severity:
          </p>
          <ul className="text-sm text-gray-700 mb-3 pl-5 list-disc space-y-0.5">
            <li><span className="font-medium text-red-700">critical</span> × 3</li>
            <li><span className="font-medium text-orange-600">warning</span> × 2</li>
            <li><span className="font-medium text-blue-600">info</span> × 1</li>
          </ul>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-2 text-sm text-blue-900 space-y-1">
            <p><span className="font-semibold">If message count is known:</span></p>
            <p className="font-mono text-xs">penalty = min(60, weighted / (messages × 3) × 60)</p>
            <p className="text-xs opacity-80">(every email with a critical alert hits the max −60)</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3 text-sm text-blue-900 space-y-1">
            <p><span className="font-semibold">If message count is unknown:</span></p>
            <p className="font-mono text-xs">penalty = min(60, weighted × 4)</p>
          </div>
          <p className="text-sm text-gray-600 mb-5">
            <span className="font-semibold">Minimum −3</span> whenever any alert exists — a flow with alerts can never score 100.
          </p>

          {/* Example */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-900 mb-2">Example: &ldquo;Welcome - Gravite&rdquo;</p>
            <ul className="text-xs text-gray-700 space-y-1 font-mono">
              <li>Open rate 22% → −10 (below 25%)</li>
              <li>Click rate 1.2% → 0</li>
              <li>Bounce 0.3% → 0</li>
              <li>Spam 0.01% → 0</li>
              <li>Unsub 0.5% → 0</li>
              <li>1 critical alert / 10 emails → ratio 0.1 → −6</li>
            </ul>
            <p className="text-sm font-semibold text-gray-900 mt-3">
              Total: 100 − 10 − 6 = <span className="text-green-700">84 (Healthy)</span>
            </p>
          </div>
        </section>

        {/* Alerts */}
        <section>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Alerts</h1>
          <p className="text-sm text-gray-600 mb-4">
            Generated after every data pull. All alerts respect the <code className="bg-gray-100 px-1 rounded text-xs">min_recipients</code> setting — no alert fires on a flow/email below that volume in the current week.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoBlock
              title="Absolute thresholds"
              desc="Fire when a metric crosses a fixed value. Good for &ldquo;always bad&rdquo; states."
              items={[
                'Spam complaint rate above X%',
                'Bounce rate above X%',
                'Unsubscribe rate above X%',
                'Open rate below X% (since &ldquo;too low&rdquo; is universal)',
              ]}
            />
            <InfoBlock
              title="Drop detection (week-over-week)"
              desc="Fire when a metric drops significantly vs last week. Good for metrics that vary by flow."
              items={[
                'Revenue drop ≥ X% — flow + per-email',
                'Open rate drop ≥ X% — also catches problems even when absolute value is OK',
                'Click rate drop ≥ X% — main signal (no absolute threshold)',
              ]}
            />
          </div>

          <p className="text-xs text-gray-500 mt-4">
            All thresholds are editable in <a href="/settings" className="text-blue-600 hover:underline">Settings</a>.
          </p>
        </section>

        {/* Date windows */}
        <section>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Time windows</h1>
          <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
            <li>
              <span className="font-semibold">Default alerts</span> = week-over-week (current full Sun–Sat week vs the prior one).
              Generated at pull time and stored in the database.
            </li>
            <li>
              <span className="font-semibold">Dashboard filters</span> (Last 7 / 30 / 90 days, MTD, YTD, custom) aggregate weekly snapshots in the selected range.
              Metrics and totals update but alerts don&apos;t.
            </li>
            <li>
              <span className="font-semibold">Inside a flow</span> — open a flow and use the timeframe selector to compute alerts for a different window (e.g. last 30 days vs prior 30).
              These are view-only and not saved.
            </li>
            <li>
              <span className="font-semibold">Scheduled sync</span> — the app automatically pulls fresh data every <span className="font-medium">Sunday at 06:00 Israel time</span>.
            </li>
          </ul>
        </section>

      </div>
    </div>
  )
}

function MetricCard({
  title,
  rows,
}: {
  title: string
  rows: { label: string; penalty: string; note?: string }[]
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-900">{title}</p>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-b-0">
              <td className="px-3 py-1.5 text-gray-600 font-mono">{r.label}</td>
              <td className="px-3 py-1.5 text-right font-semibold text-red-600">{r.penalty}</td>
              {r.note && (
                <td className="px-3 py-1.5 text-right text-gray-400 italic">{r.note}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InfoBlock({ title, desc, items }: { title: string; desc: string; items: string[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-900 mb-1">{title}</p>
      <p className="text-xs text-gray-500 mb-2">{desc}</p>
      <ul className="text-xs text-gray-700 space-y-1 list-disc pl-4">
        {items.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: item }} />)}
      </ul>
    </div>
  )
}
