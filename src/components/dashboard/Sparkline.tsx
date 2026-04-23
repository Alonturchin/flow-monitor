'use client'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
}

export default function Sparkline({ data, width = 80, height = 28, color = '#3b82f6' }: SparklineProps) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-gray-300 text-xs">—</div>
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  })

  const lastVal = data[data.length - 1]
  const firstVal = data[0]
  const trending = lastVal >= firstVal

  const lineColor = trending ? '#22c55e' : '#ef4444'

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
