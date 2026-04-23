import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { hashPassword } from '@/lib/password'

interface Params { params: { id: string } }

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

/** DELETE /api/admin/users/:id — remove a user (admin only) */
export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const id = Number(params.id)
    const user = await queryOne<{ email: string; role: string }>(
      `SELECT email, role FROM users WHERE id = $1`, [id]
    )
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Can't delete yourself
    if (user.email === auth.session?.user?.email?.toLowerCase()) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
    }

    // Can't delete the last admin
    if (user.role === 'admin') {
      const adminCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`
      )
      if (adminCount && Number(adminCount.count) <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last admin' }, { status: 400 })
      }
    }

    await query(`DELETE FROM users WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/admin/users/:id] DELETE', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** PATCH /api/admin/users/:id — update password or role (admin only) */
export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  try {
    const id = Number(params.id)
    const body = await req.json() as { password?: string; role?: string }

    if (body.password) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
      }
      await query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [hashPassword(body.password), id]
      )
    }

    if (body.role && (body.role === 'admin' || body.role === 'user')) {
      // Can't downgrade last admin
      if (body.role === 'user') {
        const user = await queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id])
        if (user?.role === 'admin') {
          const adminCount = await queryOne<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`
          )
          if (adminCount && Number(adminCount.count) <= 1) {
            return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
          }
        }
      }
      await query(`UPDATE users SET role = $1 WHERE id = $2`, [body.role, id])
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/admin/users/:id] PATCH', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
