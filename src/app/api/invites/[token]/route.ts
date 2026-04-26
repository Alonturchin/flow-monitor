import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

interface Params { params: { token: string } }

/** GET /api/invites/:token — fetch invite metadata (public) */
export async function GET(_req: Request, { params }: Params) {
  const invite = await queryOne<{
    email: string
    role: string
    expires_at: string
    used_at: string | null
  }>(
    `SELECT email, role, expires_at, used_at
     FROM user_invites
     WHERE token = $1`,
    [params.token]
  )

  if (!invite) {
    return NextResponse.json({ error: 'Invalid invite' }, { status: 404 })
  }
  if (invite.used_at) {
    return NextResponse.json({ error: 'This invite has already been used' }, { status: 410 })
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }

  return NextResponse.json({ email: invite.email, role: invite.role })
}
