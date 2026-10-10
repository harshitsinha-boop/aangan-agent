import { actionUrl, mintToken } from '@/lib/tokens'
import { env } from '@/lib/env'
import { loadConfig } from '@/lib/config'
import { formatIST } from '@/lib/hours'
import { getMailer } from '@/lib/mail'
import { confirmationEmail, escalationEmail, handoffEmail, reminderEmail, type HandoffData, type RubricLine } from '@/lib/email/compose'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'

const dash = (path: string) => `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/dashboard${path}`
const RUBRIC_LABELS: Record<string, string> = {
  real_project: 'Real project with execution', service_area: 'In service area (Pune / PCMC)',
  timeline: 'Realistic timeline', budget: 'Budget broadly aligned', decision_maker: 'Decision-maker on the call',
}

async function recordSent(db: Db, messageId: string | null, kind: string) {
  if (!messageId) return
  await db.from('email_events').insert({ email_message_id: messageId, type: 'sent', payload: { kind } })
}

async function handoffPayload(db: Db, handoffId: string) {
  const h = must(await db.from('handoffs').select('*, designers(name,email)').eq('id', handoffId).single(), 'load handoff')
  const lead = must(await db.from('leads').select('*, callers(phone,name), calls(summary)').eq('id', h.lead_id).single(), 'load lead')
  const consult = must(
    await db.from('consultations').select('slot_start,visit_type').eq('lead_id', h.lead_id).eq('status', 'booked')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    'load consultation',
  )
  return { h, lead, consult }
}

/** Mints Accept/Reassign links and builds the handoff message for the designer who currently owns the handoff. */
async function buildHandoff(db: Db, handoffId: string, ttlHours: number): Promise<{ to: string; data: HandoffData; leadId: string }> {
  const { h, lead, consult } = await handoffPayload(db, handoffId)
  const recipient = h.designers.email as string
  const [accept, reassign] = await Promise.all([
    mintToken(db, { action: 'accept', targetTable: 'handoffs', targetId: handoffId, recipient, ttlHours }),
    mintToken(db, { action: 'reassign', targetTable: 'handoffs', targetId: handoffId, recipient, ttlHours }),
  ])
  const verdict = (lead.rubric_verdict ?? {}) as Record<string, { status: RubricLine['status']; note?: string | null }>
  const rubric: RubricLine[] = Object.keys(RUBRIC_LABELS).map((k) => ({
    label: RUBRIC_LABELS[k], status: verdict[k]?.status ?? 'unclear', note: verdict[k]?.note ?? null,
  }))
  return {
    to: recipient,
    leadId: lead.id,
    data: {
      name: lead.callers?.name ?? null, phone: lead.callers?.phone ?? null, location: lead.location, projectType: lead.project_type,
      carpetArea: lead.carpet_area_sqft, scope: lead.current_state, timeline: lead.timeline, budget: lead.budget_volunteered,
      source: lead.source_or_referrer, rubric, uncertainty: lead.uncertainty_notes,
      consultation: consult ? { when: formatIST(consult.slot_start), visitType: consult.visit_type } : null,
      summary: lead.calls?.summary ?? 'Summary not available yet.', priority: lead.priority,
      acceptUrl: actionUrl(accept), reassignUrl: actionUrl(reassign), dashboardUrl: dash(`/leads/${lead.id}`),
    },
  }
}

/** Send the first handoff email. Idempotent: the sent_at claim guarantees one email per handoff even if
 *  the webhook and the polling backfill race. */
export async function sendHandoffEmail(db: Db, handoffId: string): Promise<boolean> {
  const claim = must<{ id: string }[]>(
    await db.from('handoffs').update({ sent_at: new Date().toISOString() }).eq('id', handoffId).is('sent_at', null).select('id'),
    'claim handoff',
  )
  if (!claim.length) return false
  try {
    const cfg = await loadConfig(db)
    const b = await buildHandoff(db, handoffId, cfg.handoffTokenHours)
    const m = await handoffEmail(b.data)
    const { id } = await getMailer().send({ to: b.to, ...m, tags: { kind: 'handoff' } })
    await db.from('handoffs').update({ email_message_id: id }).eq('id', handoffId)
    await recordSent(db, id, 'handoff')
    return true
  } catch (err) {
    await db.from('handoffs').update({ sent_at: null }).eq('id', handoffId) // let a retry resend
    throw err
  }
}

/** One reminder per handoff (claimed via reminder_sent_at). */
export async function sendHandoffReminder(db: Db, handoffId: string, hoursWaiting: number): Promise<boolean> {
  const claim = must<{ id: string }[]>(
    await db.from('handoffs').update({ reminder_sent_at: new Date().toISOString() }).eq('id', handoffId).is('reminder_sent_at', null)
      .is('accepted_at', null).is('reassigned_at', null).select('id'),
    'claim reminder',
  )
  if (!claim.length) return false
  try {
    const cfg = await loadConfig(db)
    const b = await buildHandoff(db, handoffId, cfg.handoffTokenHours)
    const m = await reminderEmail({ ...b.data, hoursWaiting })
    const { id } = await getMailer().send({ to: b.to, ...m, urgent: true, tags: { kind: 'handoff_reminder' } })
    await recordSent(db, id, 'handoff_reminder')
    return true
  } catch (err) {
    await db.from('handoffs').update({ reminder_sent_at: null }).eq('id', handoffId)
    throw err
  }
}

/** Reassignment creates a fresh handoff; email its new owner right away. */
export const sendReassignedHandoff = (db: Db, newHandoffId: string) => sendHandoffEmail(db, newHandoffId)

/** URGENT email to the principal and every senior designer, each with their own Acknowledge link. */
export async function sendEscalationEmails(db: Db, escalationId: string): Promise<number> {
  const cfg = await loadConfig(db)
  const esc = must(await db.from('escalations').select('*, calls(started_at,created_at)').eq('id', escalationId).single(), 'load escalation')
  const people = must<{ name: string; email: string }[]>(
    await db.from('designers').select('name,email').eq('active', true).or('is_principal.eq.true,is_senior.eq.true'),
    'load escalation recipients',
  )
  let sent = 0
  for (const p of people) {
    try {
      const tok = await mintToken(db, { action: 'acknowledge', targetTable: 'escalations', targetId: escalationId, recipient: p.email, ttlHours: cfg.escalationTokenHours })
      const m = await escalationEmail({
        name: esc.client_name, project: esc.project, designer: esc.designer_name, issue: esc.issue_summary,
        calledAt: formatIST(esc.calls?.started_at ?? esc.created_at), callbackMinutes: cfg.escalationCallbackMinutes,
        acknowledgeUrl: actionUrl(tok), dashboardUrl: dash('/escalations'),
      })
      const { id } = await getMailer().send({ to: p.email, ...m, urgent: true, tags: { kind: 'escalation' } })
      await recordSent(db, id, 'escalation')
      sent++
    } catch (err) {
      console.error('escalation email failed', p.email, err)
    }
  }
  return sent
}

/** Caller confirmation (only if an email was captured). No pricing language. */
export async function sendBookingConfirmation(db: Db, consultationId: string): Promise<boolean> {
  const c = must(
    await db.from('consultations').select('slot_start,visit_type, designers(name), leads(callers(name,email))').eq('id', consultationId).single(),
    'load consultation',
  )
  const caller = c.leads?.callers
  if (!caller?.email) return false
  const cfg = await loadConfig(db)
  const m = await confirmationEmail({
    name: caller.name, when: formatIST(c.slot_start), visitType: c.visit_type,
    designerFirstName: String(c.designers?.name ?? 'Your designer').split(' ')[0], studioAddress: cfg.studioAddress,
  })
  const { id } = await getMailer().send({ to: caller.email, ...m, tags: { kind: 'confirmation' } })
  await recordSent(db, id, 'confirmation')
  return true
}
