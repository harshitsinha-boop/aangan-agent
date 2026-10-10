import { loadConfig, type AppConfig } from '@/lib/config'
import { env } from '@/lib/env'
import { businessMinutesBetween } from '@/lib/hours'
import { runHubspotSync } from '@/lib/hubspot/sync'
import { sendHandoffEmail, sendHandoffReminder, sendReassignedHandoff } from '@/lib/notify'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'
import { triggerCall } from '@/lib/vaani'

export type HandoffAction = 'reassign' | 'remind' | 'none'

/** Pure SLA rule. Clock = business-hours minutes since the handoff email was sent.
 *  >= T: one reminder. >= 2T: reassign to the principal (unless the owner already IS the principal). */
export function decideHandoffAction(
  h: { sent_at: string; reminder_sent_at: string | null; ownerIsPrincipal: boolean },
  cfg: AppConfig,
  now: Date,
): { action: HandoffAction; waitedMinutes: number } {
  const waited = businessMinutesBetween(new Date(h.sent_at), now, cfg.businessHours)
  const T = cfg.handoffAcceptHours * 60
  if (waited >= 2 * T && !h.ownerIsPrincipal) return { action: 'reassign', waitedMinutes: waited }
  if (waited >= T && !h.reminder_sent_at) return { action: 'remind', waitedMinutes: waited }
  return { action: 'none', waitedMinutes: waited }
}

/** An escalation is due for the fallback call when unacknowledged, not yet called, and older than the threshold. */
export function escalationDue(e: { sent_at: string | null; acknowledged_at: string | null; fallback_call_at: string | null }, cfg: AppConfig, now: Date): boolean {
  if (!e.sent_at || e.acknowledged_at || e.fallback_call_at) return false
  return now.getTime() - new Date(e.sent_at).getTime() >= cfg.escalationAckMinutes * 60_000
}

/** Variables the alert agent's script reads out (agent/alert-agent-prompt.md). */
export const fallbackMetadata = (e: { client_name: string | null; project: string | null; issue_summary: string | null }, cfg: AppConfig) => ({
  client_name: e.client_name ?? 'an existing client',
  project: e.project ?? 'their project',
  issue: e.issue_summary ?? 'an unresolved complaint',
  callback_minutes: cfg.escalationCallbackMinutes,
})

export type SlaReport = { fallbackCalls: number; reminders: number; reassigned: number; resent: number; hubspot?: { synced: number; failed: number }; errors: string[] }

/** Escalation not acknowledged within escalation_ack_minutes -> Vaani places a fallback call to the studio head. */
export async function runEscalationFallbacks(db: Db, cfg: AppConfig, now: Date, report: SlaReport) {
  const cutoff = new Date(now.getTime() - cfg.escalationAckMinutes * 60_000).toISOString()
  const due = must<{ id: string; client_name: string | null; project: string | null; issue_summary: string | null }[]>(
    await db.from('escalations').select('id,client_name,project,issue_summary').is('acknowledged_at', null).is('fallback_call_at', null).lte('sent_at', cutoff),
    'due escalations',
  )
  if (!due.length) return
  const e = env()
  if (!e.VAANI_API_KEY || !e.VAANI_ALERT_AGENT_ID) { report.errors.push('fallback call skipped: VAANI_API_KEY / VAANI_ALERT_AGENT_ID not set'); return }
  const principal = must<{ name: string; phone: string | null } | null>(
    await db.from('designers').select('name,phone').eq('is_principal', true).eq('active', true).maybeSingle(), 'principal',
  )
  if (!principal?.phone) { report.errors.push('fallback call skipped: principal designer has no phone number'); return }

  for (const esc of due) {
    // Claim first so two overlapping cron runs can never place two calls.
    const claim = must<{ id: string }[]>(
      await db.from('escalations').update({ fallback_call_at: now.toISOString() }).eq('id', esc.id).is('fallback_call_at', null).is('acknowledged_at', null).select('id'),
      'claim fallback',
    )
    if (!claim.length) continue
    try {
      const { callId } = await triggerCall({
        agentId: e.VAANI_ALERT_AGENT_ID, contactNumber: principal.phone, name: principal.name,
        metadata: fallbackMetadata(esc, cfg),
      })
      await db.from('escalations').update({ fallback_vaani_call_id: callId }).eq('id', esc.id)
      report.fallbackCalls++
    } catch (err) {
      await db.from('escalations').update({ fallback_call_at: null }).eq('id', esc.id) // retry next minute
      report.errors.push(`fallback call failed for ${esc.id}: ${(err as Error).message}`)
    }
  }
}

/** Not accepted after T business-hours: reminder. After 2T: reassign to the principal designer. */
export async function runHandoffSla(db: Db, cfg: AppConfig, now: Date, report: SlaReport) {
  const live = must<{ id: string; sent_at: string; reminder_sent_at: string | null; designers: { is_principal: boolean } }[]>(
    await db.from('handoffs').select('id,sent_at,reminder_sent_at, designers(is_principal)').is('accepted_at', null).is('reassigned_at', null).not('sent_at', 'is', null),
    'live handoffs',
  )
  for (const h of live) {
    try {
      const { action, waitedMinutes } = decideHandoffAction({ sent_at: h.sent_at, reminder_sent_at: h.reminder_sent_at, ownerIsPrincipal: h.designers.is_principal }, cfg, now)
      if (action === 'reassign') {
        const newId = must<string>(await db.rpc('reassign_handoff', { p_handoff_id: h.id, p_to: null }), 'reassign')
        report.reassigned++
        await sendReassignedHandoff(db, newId)
      } else if (action === 'remind') {
        if (await sendHandoffReminder(db, h.id, waitedMinutes / 60)) report.reminders++
      }
    } catch (err) {
      report.errors.push(`handoff ${h.id}: ${(err as Error).message}`)
    }
  }
}

/** A live handoff whose first email never went out (provider hiccup, crash between steps): retry it. The sent_at
 *  claim inside sendHandoffEmail guarantees one email even if two runs overlap. */
export async function runUnsentHandoffs(db: Db, now: Date, report: SlaReport) {
  const cutoff = new Date(now.getTime() - 2 * 60_000).toISOString()
  const rows = must<{ id: string }[]>(
    await db.from('handoffs').select('id').is('sent_at', null).is('reassigned_at', null).is('accepted_at', null).lte('created_at', cutoff),
    'unsent handoffs',
  )
  for (const h of rows) {
    try { if (await sendHandoffEmail(db, h.id)) report.resent++ } catch (err) { report.errors.push(`resend ${h.id}: ${(err as Error).message}`) }
  }
}

export async function runSlaCheck(db: Db, now = new Date()): Promise<SlaReport> {
  const cfg = await loadConfig(db)
  const report: SlaReport = { fallbackCalls: 0, reminders: 0, reassigned: 0, resent: 0, errors: [] }
  await runEscalationFallbacks(db, cfg, now, report)
  await runUnsentHandoffs(db, now, report)
  await runHandoffSla(db, cfg, now, report)
  report.hubspot = await runHubspotSync(db).catch((e) => { report.errors.push(`hubspot: ${(e as Error).message}`); return undefined })
  return report
}
