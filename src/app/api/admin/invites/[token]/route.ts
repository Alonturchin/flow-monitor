import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'

interface Params { params: { token: string } }

/** DELETE /api/admin/invites/:token — revoke a pending invite (admin only) */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(`DELETE FROM user_invites WHERE token = $1 AND used_at IS NULL`, [params.token])
  return NextResponse.json({ ok: true })
}
