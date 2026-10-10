'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { userDb } from '@/lib/supabase/server'

const Creds = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) })

export type LoginState = { error?: string }

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = Creds.safeParse({ email: form.get('email'), password: form.get('password') })
  if (!parsed.success) return { error: 'Enter a valid email and password.' }
  const db = await userDb()
  const { error } = await db.auth.signInWithPassword(parsed.data)
  // One generic message: never reveal whether the email exists.
  if (error) return { error: 'Invalid email or password.' }
  redirect('/dashboard')
}

export async function signOut() {
  const db = await userDb()
  await db.auth.signOut()
  redirect('/login')
}
