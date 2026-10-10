import { adminDb, type Db } from '@/lib/supabase/admin'

/**
 * The dashboard is OPEN: no login (owner's decision, test phase). Every table still has RLS with no anonymous
 * policies, so the database itself stays closed to the internet; only these server-rendered pages read it, using the
 * service-role key on the server (never sent to the browser). Read-only: there are no write actions behind it.
 * To protect it again later, restore the Supabase-auth version from git commit bb3ed2c.
 */
export const dashboardDb = (): Db => adminDb()
