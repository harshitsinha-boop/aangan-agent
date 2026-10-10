import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { ForceFieldBackground } from '@/components/brand/force-field-lazy'
import { userDb } from '@/lib/supabase/server'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in · Aangan Studio', robots: { index: false } }

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#140d08] px-4 py-10">
      {/* Brand layer: full-screen, behind the card. Not used anywhere else except the dashboard hero band. */}
      <ForceFieldBackground />
      <div className="relative z-10 w-full max-w-sm">
        <h1 className="mb-6 text-center font-serif text-4xl tracking-[0.18em] text-[#f1dcc4]">AANGAN</h1>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-7 backdrop-blur-md">
          <p className="mb-5 text-sm text-white/60">Studio dashboard</p>
          <Suspense fallback={<div className="h-56 animate-pulse rounded-lg bg-white/5" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  )
}

async function Form({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  // Already signed in as an admin: skip the form.
  const db = await userDb()
  const { data } = await db.auth.getUser()
  if (data.user && error !== 'no_access') {
    const admin = await db.from('admin_users').select('user_id').eq('user_id', data.user.id).maybeSingle()
    if (admin.data) redirect('/dashboard')
  }
  return <LoginForm noAccess={error === 'no_access'} />
}
