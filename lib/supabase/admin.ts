import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

// Untyped on purpose: schema types would need generated DB types (added when the dashboard needs them).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, 'public', any>

let client: Db | undefined

/** Service-role client. Server-only: bypasses RLS. Never import from a client component. */
export function adminDb(): Db {
  if (!client) {
    const e = env()
    client = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

/** Throw on a Supabase error, return data otherwise. Rows are untyped; callers annotate with T. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must<T = any>(r: { data: unknown; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data as T
}
