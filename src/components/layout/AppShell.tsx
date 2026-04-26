'use client'

import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import Sidebar from './Sidebar'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <SessionProvider>{children}</SessionProvider>
  }

  return (
    <SessionProvider>
      <div className="flex h-screen overflow-hidden">
        <Suspense fallback={<aside className="w-64 bg-white border-r border-gray-200" />}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </SessionProvider>
  )
}
