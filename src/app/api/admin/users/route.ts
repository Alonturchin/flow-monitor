import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { hashPassword } from '@/lib/password'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

/** GET /api/admin/users — list all users (admin only) */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const users = await query<{
    id: string
    email: string
    role: string
    created_at: string
    created_by: string | null
  }>(`SELECT id::text, email, role, created_at, created_by FROM users ORDER BY created_at`)

  return NextResponse.json({ users })
}

/** POST /api/admin/users — create a new user (admin only)
 *  Body: { email, password, role }
 */
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const body = await req.json() as { email?: string; password?: string; role?: string }
    const email = body.email?.toLowerCase().trim()
    const password = body.password
    const role = body.role === 'admin' ? 'admin' : 'user'

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const existing = await queryOne<{ id: string }>(`SELECT id::text FROM users WHERE email = $1`, [email])
    if (existing) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
    }

    const createdBy = auth.session?.user?.email ?? 'admin'
    await query(
      `INSERT INTO users (email, password_hash, role, created_by) VALUES ($1, $2, $3, $4)`,
      [email, hashPassword(password), role, createdBy]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/admin/users] POST', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
