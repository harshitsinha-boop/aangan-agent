import { after } from 'next/server'
import { z } from 'zod'
import { ensureCall, upsertCaller } from '@/lib/callers'
import { env } from '@/lib/env'
import { json, parseJson, requireSecret } from '@/lib/http'
import { sendEscalationEmails } from '@/lib/notify'
import { normalizePhone } from '@/lib/phone'
import { adminDb, must } from '@/lib/supabase/admin'

const Body = z.object({
  vaani_call_id: z.string().min(1),
  phone: z.string().min(5),
  name: z.string().min(1).max(120),
  project: z.string().max(300).optional(),
  designer_name: z.string().max(120).optional(),
  issue: z.string().max(600).optional(),
})

/** Existing-client complaint. Idempotent on vaani_call_id: a repeat tool call never re-sends the URGENT email. */
export async function POST(req: Request) {
  const denied = requireSecret(req, env().VAANI_TOOL_SECRET)
  if (denied) return denied
  const parsed = await parseJson(req, Body)
  if ('response' in parsed) return parsed.response
  const b = parsed.data
  const phone = normalizePhone(b.phone)
  if (!phone) return json({ error: 'invalid_phone' }, 422)

  const db = adminDb()
  const caller = await upsertCaller(db, phone, { name: b.name, is_existing_client: true })
  const call = await ensureCall(db, b.vaani_call_id, { caller_id: caller.id, intent: 'complaint', outcome: 'escalated' })

  const prior = must<{ id: string } | null>(await db.from('escalations').select('id').eq('call_id', call.id).maybeSingle(), 'find escalation')
  if (prior) return json({ ok: true, escalation_id: prior.id, duplicate: true })

  const ins = await db.from('escalations')
    .insert({ call_id: call.id, client_name: b.name, project: b.project ?? null, designer_name: b.designer_name ?? null, issue_summary: b.issue ?? null, sent_at: new Date().toISOString() })
    .select('id').single()
  if (ins.error?.code === '23505') return json({ ok: true, duplicate: true }) // concurrent duplicate
  const esc = must<{ id: string }>(ins, 'create escalation')

  after(async () => {
    const n = await sendEscalationEmails(db, esc.id)
    if (n === 0) console.error('escalation emails: none delivered; SLA fallback call will cover', esc.id)
  })
  return json({ ok: true, escalation_id: esc.id, callback_within_minutes: 15 })
}
