// NextAuth configuration — server-side only.

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { query, queryOne } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/password'

export type UserRole = 'admin' | 'user'

interface DbUser {
  id: string
  email: string
  password_hash: string
  role: UserRole
}

/**
 * Ensure at least one admin exists.
 * Seeds from ADMIN_EMAIL + ADMIN_PASSWORD env vars (or falls back to AUTH_EMAIL/AUTH_PASSWORD).
 * Called on first login attempt.
 */
let seedAttempted = false
async function ensureAdminSeed(): Promise<void> {
  if (seedAttempted) return
  seedAttempted = true

  try {
    const existing = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`)
    if (existing && Number(existing.count) > 0) return

    const email = process.env.ADMIN_EMAIL ?? process.env.AUTH_EMAIL
    const password = process.env.ADMIN_PASSWORD ?? process.env.AUTH_PASSWORD
    if (!email || !password) {
      console.warn('[auth] No admin user and no ADMIN_EMAIL/ADMIN_PASSWORD set — cannot seed')
      return
    }

    await query(
      `INSERT INTO users (email, password_hash, role, created_by)
       VALUES ($1, $2, 'admin', 'system')
       ON CONFLICT (email) DO NOTHING`,
      [email.toLowerCase().trim(), hashPassword(password)]
    )
    console.log(`[auth] Seeded admin user: ${email}`)
  } catch (err) {
    console.error('[auth] Failed to seed admin:', err)
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        await ensureAdminSeed()

        const user = await queryOne<DbUser>(
          `SELECT id::text, email, password_hash, role FROM users WHERE email = $1`,
          [credentials.email.toLowerCase().trim()]
        )
        if (!user) return null

        if (!verifyPassword(credentials.password, user.password_hash)) return null

        return {
          id: user.id,
          email: user.email,
          name: user.email,
          role: user.role,
        }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user && 'role' in user) {
        token.role = (user as { role: UserRole }).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.role) {
        (session.user as typeof session.user & { role?: UserRole }).role = token.role as UserRole
      }
      return session
    },
  },
}
