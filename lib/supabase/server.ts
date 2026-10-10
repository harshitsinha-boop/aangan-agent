import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Db } from '@/lib/supabase/admin'

/** Per-request client acting AS THE SIGNED-IN USER (anon key + session cookie), so RLS applies. Not the service role. */
export async function userDb(): Promise<Db> {
  const jar = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => jar.set(name, value, options)) } catch { /* called from a Server Component: the proxy refreshes the session instead */ }
      },
    },
  }) as unknown as Db
}
