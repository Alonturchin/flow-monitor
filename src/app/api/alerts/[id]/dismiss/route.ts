import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface Params { params: { id: string } }

export async function POST(_req: Request, { params }: Params) {
  try {
    await query(
      `UPDATE alerts SET dismissed_at = NOW(), resolved_at = COALESCE(resolved_at, NOW()) WHERE id = $1`,
      [Number(params.id)]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
