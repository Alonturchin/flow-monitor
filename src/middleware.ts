import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
})

export const config = {
  // Protect everything except: auth API, public invite API/page, Next.js internals, static assets, login
  matcher: ['/((?!api/auth|api/invites|_next/static|_next/image|favicon.ico|login|invite).*)'],
}
