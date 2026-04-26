import { NextResponse } from 'next/server'
import { withTransaction } from '@/lib/db'
import { hashPassword } from '@/lib/password'

interface Params { params: { token: string } }

/** POST /api/invites/:token/accept — consume an invite, create the user (public)
 *  Body: { password }
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const body = await req.json() as { password?: string }
    const password = body.password
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const result = await withTransaction(async (client) => {
      const inviteRes = await client.query(
        `SELECT email, role, expires_at, used_at
         FROM user_invites
         WHERE token = $1
         FOR UPDATE`,
        [params.token]
      )
      const invite = inviteRes.rows[0] as
        | { email: string; role: 'admin' | 'user'; expires_at: string; used_at: string | null }
        | undefined

      if (!invite) return { status: 404 as const, error: 'Invalid invite' }
      if (invite.used_at) return { status: 410 as const, error: 'This invite has already been used' }
      if (new Date(invite.expires_at) < new Date()) {
        return { status: 410 as const, error: 'This invite has expired' }
      }

      const existing = await client.query(
        `SELECT id FROM users WHERE email = $1`,
        [invite.email]
      )
      if (existing.rows[0]) {
        return { status: 409 as const, error: 'A user with this email already exists' }
      }

      await client.query(
        `INSERT INTO users (email, password_hash, role, created_by)
         VALUES ($1, $2, $3, $4)`,
        [invite.email, hashPassword(password), invite.role, 'invite']
      )
      await client.query(
        `UPDATE user_invites SET used_at = now() WHERE token = $1`,
        [params.token]
      )
      return { status: 200 as const, ok: true }
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/invites/accept] POST', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
