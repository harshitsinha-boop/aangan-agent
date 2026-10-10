import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { signOut } from '@/app/login/actions'

export const metadata: Metadata = { title: 'Dashboard · Aangan Studio', robots: { index: false, follow: false } }

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/dashboard" className="font-serif text-lg tracking-[0.18em] text-primary">AANGAN</Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground">Overview</Link>
            <Link href="/dashboard/escalations" className="hover:text-foreground">Escalations</Link>
          </nav>
          <form action={signOut} className="ml-auto"><button className="text-sm text-muted-foreground hover:text-foreground">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6">{children}</main>
    </div>
  )
}
