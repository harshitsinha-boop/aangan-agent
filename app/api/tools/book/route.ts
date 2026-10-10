import { after } from 'next/server'
import { ensureCall, upsertCaller } from '@/lib/callers'
import { env } from '@/lib/env'
import { formatIST } from '@/lib/hours'
import { json, parseJson, requireSecret } from '@/lib/http'
import { sendBookingConfirmation } from '@/lib/notify'
import { normalizePhone } from '@/lib/phone'
import { adminDb, must } from '@/lib/supabase/admin'
import { findSlots } from '@/lib/tools/availability'
import { BookBody } from '@/lib/tools/schemas'

/** Books a slot for this call. Idempotent on vaani_call_id: a retry returns the same consultation. */
export async function POST(req: Request) {
  const denied = requireSecret(req, env().VAANI_TOOL_SECRET)
  if (denied) return denied
  const parsed = await parseJson(req, BookBody)
  if ('response' in parsed) return parsed.response
  const b = parsed.data
  const phone = normalizePhone(b.phone)
  if (!phone) return json({ error: 'invalid_phone' }, 422)

  const db = adminDb()
  const caller = await upsertCaller(db, phone, { name: b.name, email: b.email })
  const call = await ensureCall(db, b.vaani_call_id, { caller_id: caller.id })

  // Draft lead for this call; the post-call ingest completes it. Booking = the agent qualified the caller.
  const draft: Record<string, unknown> = { call_id: call.id, caller_id: caller.id }
  for (const k of ['project_type', 'location', 'carpet_area_sqft', 'current_state', 'timeline', 'budget_volunteered', 'source_or_referrer'] as const) {
    if (b[k] !== undefined) draft[k] = b[k]
  }
  if (b.priority) draft.priority = true
  const lead = must<{ id: string; priority: boolean }>(
    await db.from('leads').upsert(draft, { onConflict: 'call_id' }).select('id,priority').single(), 'upsert lead',
  )

  const existing = must<{ id: string; slot_start: string; visit_type: string; slot_id: string; designers: { name: string } } | null>(
    await db.from('consultations').select('id,slot_id,slot_start,visit_type, designers(name)').eq('lead_id', lead.id).eq('status', 'booked').maybeSingle(),
    'existing consultation',
  )
  if (existing) {
    return json({ ok: true, already_booked: existing.slot_id === b.slot_id, consultation: summarize(existing), confirmation_email: 'not_resent' }, existing.slot_id === b.slot_id ? 200 : 409)
  }

  const slot = must<{ designer_id: string; designers: { is_principal: boolean } } | null>(
    await db.from('availability_slots').select('designer_id, designers(is_principal)').eq('id', b.slot_id).maybeSingle(), 'load slot',
  )
  if (!slot) return json({ error: 'slot_not_found' }, 404)
  if (lead.priority && !slot.designers.is_principal) {
    return json({ error: 'slot_not_for_priority', alternatives: await findSlots(db, { priority: true }) }, 409)
  }

  const r = await db.rpc('book_slot', { p_slot_id: b.slot_id, p_lead_id: lead.id })
  if (r.error) {
    if (r.error.message.includes('slot_unavailable')) {
      return json({ error: 'slot_unavailable', alternatives: await findSlots(db, { priority: lead.priority }) }, 409)
    }
    throw new Error(`book_slot: ${r.error.message}`)
  }
  const consultation = r.data as { id: string; slot_start: string; visit_type: string; designer_id: string }
  const designer = must<{ name: string }>(await db.from('designers').select('name').eq('id', consultation.designer_id).single(), 'load designer')

  const willEmail = !!(b.email ?? caller.email)
  if (willEmail) after(() => sendBookingConfirmation(db, consultation.id).catch((e) => console.error('confirmation email failed', e)))
  return json({
    ok: true,
    consultation: summarize({ ...consultation, designers: designer }),
    confirmation_email: willEmail ? 'queued' : 'no_email_on_file',
  })
}

function summarize(c: { slot_start: string; visit_type: string; designers: { name: string } }) {
  return { when: formatIST(c.slot_start), visit_type: c.visit_type, designer_first_name: c.designers.name.split(' ')[0] }
}
