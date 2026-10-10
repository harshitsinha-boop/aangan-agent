import { ensureCall, upsertCaller } from '@/lib/callers'
import { loadConfig } from '@/lib/config'
import { env } from '@/lib/env'
import { isBusinessHours } from '@/lib/hours'
import { json, parseJson, requireSecret } from '@/lib/http'
import { normalizePhone } from '@/lib/phone'
import { adminDb, must } from '@/lib/supabase/admin'
import { LookupCallerBody } from '@/lib/tools/schemas'

/** Called by the agent at the start of every call. Also links this call to the caller so the post-call webhook knows who rang. */
export async function POST(req: Request) {
  const denied = requireSecret(req, env().VAANI_TOOL_SECRET)
  if (denied) return denied
  const parsed = await parseJson(req, LookupCallerBody)
  if ('response' in parsed) return parsed.response
  const phone = normalizePhone(parsed.data.phone)
  if (!phone) return json({ found: false, recent: false, error: 'invalid_phone' })

  const db = adminDb()
  const caller = await upsertCaller(db, phone)
  if (parsed.data.vaani_call_id) await ensureCall(db, parsed.data.vaani_call_id, { caller_id: caller.id })

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const calls = must<{ vaani_call_id: string; created_at: string; outcome: string | null; intent: string | null; summary: string | null }[]>(
    await db.from('calls').select('vaani_call_id,created_at,outcome,intent,summary').eq('caller_id', caller.id)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(6),
    'recent calls',
  )
  const previous = calls.filter((c) => c.vaani_call_id !== parsed.data.vaani_call_id)
  const leads = must<{ status: string; project_type: string | null; location: string | null }[]>(
    await db.from('leads').select('status,project_type,location').eq('caller_id', caller.id).order('created_at', { ascending: false }).limit(3),
    'caller leads',
  )
  const cfg = await loadConfig(db)
  return json({
    studio_open_now: isBusinessHours(new Date(), cfg.businessHours),
    caller_known: !!caller.name || previous.length > 0,
    name: caller.name,
    is_existing_client: caller.is_existing_client,
    has_recent_record: previous.length > 0,
    recent_calls: previous.slice(0, 3).map((c) => ({ when: c.created_at, outcome: c.outcome, intent: c.intent, summary: c.summary })),
    leads,
  })
}
