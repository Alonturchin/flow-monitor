import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'
import { randomBytes } from 'crypto'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

interface InviteRow {
  token: string
  email: string
  role: 'admin' | 'user'
  created_by: string | null
  created_at: string
  expires_at: string
  used_at: string | null
}

/** GET /api/admin/invites — list all invites (admin only) */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const invites = await query<InviteRow>(
    `SELECT token, email, role, created_by, created_at, expires_at, used_at
     FROM user_invites
     ORDER BY created_at DESC`
  )
  return NextResponse.json({ invites })
}

/** POST /api/admin/invites — create a new invite (admin only)
 *  Body: { email, role }
 *  Returns: { ok, token }
 */
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const body = await req.json() as { email?: string; role?: string }
    const email = body.email?.toLowerCase().trim()
    const role = body.role === 'admin' ? 'admin' : 'user'

    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 })
    }

    // If a user already exists, the invite acts as a password reset link.
    // Role from the body is ignored in that case (handled in the accept route).
    const token = randomBytes(32).toString('hex')
    const createdBy = auth.session?.user?.email ?? 'admin'

    await query(
      `INSERT INTO user_invites (token, email, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + INTERVAL '7 days')`,
      [token, email, role, createdBy]
    )

    return NextResponse.json({ ok: true, token })
  } catch (err) {
    console.error('[api/admin/invites] POST', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
