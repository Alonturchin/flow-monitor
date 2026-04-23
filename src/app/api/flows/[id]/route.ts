import { NextResponse } from 'next/server'
import { getFlowDetail } from '@/lib/queries'

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  try {
    const detail = await getFlowDetail(params.id)
    if (!detail) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (err) {
    console.error(`[api/flows/${params.id}] Query failed:`, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
