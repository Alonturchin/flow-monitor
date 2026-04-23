import { NextResponse } from 'next/server'
import { getActiveAlerts, getFlowAlerts } from '@/lib/alert-engine'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const flowId = searchParams.get('flow_id')
    const alerts = flowId ? await getFlowAlerts(flowId) : await getActiveAlerts()
    return NextResponse.json({ alerts, count: alerts.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
