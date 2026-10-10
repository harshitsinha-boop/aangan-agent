import { env } from '@/lib/env'
import { json, requireSecret } from '@/lib/http'
import { runSlaCheck } from '@/lib/sla'
import { adminDb } from '@/lib/supabase/admin'

export const maxDuration = 60

/** Called every minute by Supabase pg_cron + pg_net with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const denied = requireSecret(req, env().CRON_SECRET)
  if (denied) return denied
  const report = await runSlaCheck(adminDb())
  if (report.errors.length) console.error('sla-check', report.errors)
  return json({ ok: true, ...report })
}
