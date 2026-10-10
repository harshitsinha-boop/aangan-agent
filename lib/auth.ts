import { redirect } from 'next/navigation'
import { userDb } from '@/lib/supabase/server'

/** Data-access-layer guard for every dashboard page: a valid session AND a row in admin_users (read via RLS as that user). */
export async function requireAdmin() {
  const db = await userDb()
  const { data } = await db.auth.getUser()
  if (!data.user) redirect('/login')
  const row = await db.from('admin_users').select('user_id').eq('user_id', data.user.id).maybeSingle()
  if (!row.data) redirect('/login?error=no_access')
  return { db, user: data.user }
}
