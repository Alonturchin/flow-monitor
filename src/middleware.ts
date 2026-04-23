import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
})

export const config = {
  // Protect everything except: auth API, Next.js internals, static assets, login page
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)'],
}
