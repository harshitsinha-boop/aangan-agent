import { loadConfig, type AppConfig } from '@/lib/config'
import { env } from '@/lib/env'
import { businessMinutesBetween } from '@/lib/hours'
import { sendHandoffReminder, sendReassignedHandoff } from '@/lib/notify'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'
import { triggerCall } from '@/lib/vaani'

export type SlaReport = { fallbackCalls: number; reminders: number; reassigned: number; errors: string[] }

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
        metadata: { client_name: esc.client_name ?? 'an existing client', project: esc.project ?? 'their project', issue: esc.issue_summary ?? 'an unresolved complaint', callback_minutes: cfg.escalationCallbackMinutes },
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
  const T = cfg.handoffAcceptHours * 60
  for (const h of live) {
    try {
      const waited = businessMinutesBetween(new Date(h.sent_at), now, cfg.businessHours)
      if (waited >= 2 * T && !h.designers.is_principal) {
        const newId = must<string>(await db.rpc('reassign_handoff', { p_handoff_id: h.id, p_to: null }), 'reassign')
        report.reassigned++
        await sendReassignedHandoff(db, newId)
      } else if (waited >= T && !h.reminder_sent_at) {
        if (await sendHandoffReminder(db, h.id, waited / 60)) report.reminders++
      }
    } catch (err) {
      report.errors.push(`handoff ${h.id}: ${(err as Error).message}`)
    }
  }
}

export async function runSlaCheck(db: Db, now = new Date()): Promise<SlaReport> {
  const cfg = await loadConfig(db)
  const report: SlaReport = { fallbackCalls: 0, reminders: 0, reassigned: 0, errors: [] }
  await runEscalationFallbacks(db, cfg, now, report)
  await runHandoffSla(db, cfg, now, report)
  return report
}
