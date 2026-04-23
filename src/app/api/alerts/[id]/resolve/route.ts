import { NextResponse } from 'next/server'
import { resolveAlertById } from '@/lib/alert-engine'

interface Params { params: { id: string } }

export async function POST(_req: Request, { params }: Params) {
  try {
    await resolveAlertById(Number(params.id))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
