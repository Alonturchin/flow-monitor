import { NextResponse } from 'next/server'
import { getFlowDetail } from '@/lib/queries'
import { getFlowAlerts } from '@/lib/alert-engine'
import { analyzeFlow } from '@/lib/claude'
import { calcHealthScore } from '@/lib/health-score'

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 400 })
  }

  try {
    const [detail, alerts] = await Promise.all([
      getFlowDetail(params.id),
      getFlowAlerts(params.id),
    ])

    if (!detail) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    const healthScore = calcHealthScore(detail.snapshot ?? {})
    const analysis = await analyzeFlow({
      flow: detail.flow,
      snapshot: detail.snapshot,
      alerts,
      healthScore,
    })

    return NextResponse.json({ analysis, healthScore })
  } catch (err) {
    console.error(`[api/analyze/${params.id}]`, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
