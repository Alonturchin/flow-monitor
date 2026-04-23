import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

interface Params { params: { id: string } }

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'dismissed']

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { status, result } = (await req.json()) as { status: string; result?: string }

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    await query(
      `UPDATE ab_tests SET status = $1, result = COALESCE($2, result) WHERE id = $3`,
      [status, result ?? null, params.id]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
