'use client'

import { useActionState } from 'react'
import { signIn, signOut, type LoginState } from './actions'

const field = 'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-2 focus:ring-white/10'

export function LoginForm({ noAccess }: { noAccess: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {})
  return (
    <div className="space-y-5">
      {noAccess && (
        <div role="alert" className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
          This account does not have dashboard access. Ask an administrator to add you, or sign in with a different account.
          <form action={signOut} className="mt-2"><button className="underline underline-offset-2">Sign out</button></form>
        </div>
      )}
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-white/60">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required className={field} placeholder="you@studio.com" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-white/60">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
        </div>
        {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-[#c98a5b] px-4 py-2.5 text-sm font-semibold text-[#1c130d] transition hover:bg-[#d89b6c] disabled:opacity-60">
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
