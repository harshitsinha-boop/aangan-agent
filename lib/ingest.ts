import { ensureCall, upsertCaller } from '@/lib/callers'
import { classify, type GenerateJson } from '@/lib/classify'
import { loadConfig, type AppConfig } from '@/lib/config'
import { isBusinessHours } from '@/lib/hours'
import { sendHandoffEmail } from '@/lib/notify'
import { normalizePhone } from '@/lib/phone'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'
import { getCallDetails } from '@/lib/vaani'

export type CallData = {
  callId: string
  transcript: string | null
  summary: string | null
  durationSeconds: number | null
  phone: string | null
  endedAt: string | null
  recordingUrl: string | null
  raw: unknown
}

const PHONE_KEYS = ['phone_number', 'caller_number', 'from_number', 'customer_number', 'contact_number', 'caller_id']
const pickPhone = (o: Record<string, unknown> | undefined) => {
  for (const k of PHONE_KEYS) if (typeof o?.[k] === 'string') return normalizePhone(o[k] as string)
  return null
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Vaani's `call_postprocessing` payload nests everything under `data`; call_duration is in MILLISECONDS there. */
export function normalizePostprocessing(body: unknown): CallData | null {
  if (!isObj(body)) return null
  const d = isObj(body.data) ? body.data : body
  const callId = (d.call_id ?? d.room_name ?? body.call_id) as unknown
  if (typeof callId !== 'string' || !callId) return null
  const ms = typeof d.call_duration === 'number' ? d.call_duration : null
  return {
    callId,
    transcript: typeof d.transcript === 'string' ? d.transcript : null,
    summary: typeof d.summary === 'string' ? d.summary : null,
    durationSeconds: ms === null ? null : Math.round(ms / 100) / 10,
    phone: pickPhone(d) ?? pickPhone(isObj(d.entities) ? d.entities : undefined),
    endedAt: typeof body.timestamp === 'string' ? body.timestamp : null,
    recordingUrl: typeof d.recording_url === 'string' ? d.recording_url : null,
    raw: body,
  }
}

type Rate = { component: string; inr_per_unit: number }

/** cost = units × current rate. Vaani exposes no per-call cost, so this is computed from cost_rates. */
export function computeCosts(rates: Rate[], durationSeconds: number | null, agentTurns: number) {
  const minutes = (durationSeconds ?? 0) / 60
  const units: Record<string, number> = { telephony_min: minutes, stt_min: minutes, tts_min: minutes, platform_min: minutes, llm_call: agentTurns }
  return rates
    .filter((r) => r.component in units)
    .map((r) => ({ component: r.component, units: units[r.component], inr: Math.round(units[r.component] * Number(r.inr_per_unit) * 10000) / 10000 }))
}

async function latestRates(db: Db): Promise<Rate[]> {
  const rows = must<(Rate & { effective_from: string })[]>(
    await db.from('cost_rates').select('component,inr_per_unit,effective_from').lte('effective_from', new Date().toISOString().slice(0, 10))
      .order('effective_from', { ascending: false }),
    'load rates',
  )
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.component) ? false : (seen.add(r.component), true)))
}

export type IngestResult = { callId: string; outcome: string | null; leadId: string | null; handoffId: string | null; emailed: boolean }

/** Idempotent: safe to run from the webhook, the polling backfill, or both at once. */
export async function ingestCall(db: Db, input: CallData, opts: { generate?: GenerateJson; cfg?: AppConfig; now?: Date } = {}): Promise<IngestResult> {
  const cfg = opts.cfg ?? (await loadConfig(db))
  const now = opts.now ?? new Date()

  let { transcript, summary } = input
  if (!transcript) {
    const det = await getCallDetails(input.callId)
    transcript = det.transcription && !/not available/i.test(det.transcription) ? det.transcription : null
    summary = summary ?? (det.summary && !/not available/i.test(det.summary) ? det.summary : null)
  }

  // If Vaani gave the tools no call id, bookings/escalations were filed under 'tool-<phone>-<epoch>': fold them into this call.
  let adoptPhone = input.phone
  if (!adoptPhone) {
    const known = must<{ callers: { phone: string } | null } | null>(
      await db.from('calls').select('callers(phone)').eq('vaani_call_id', input.callId).maybeSingle(), 'find caller phone')
    adoptPhone = known?.callers?.phone ?? null
  }
  await db.rpc('adopt_tool_call', { p_real: input.callId, p_phone: adoptPhone })

  const existing = must<{ id: string; caller_id: string | null; outcome: string | null; started_at: string | null; intent: string | null } | null>(
    await db.from('calls').select('id,caller_id,outcome,started_at,intent').eq('vaani_call_id', input.callId).maybeSingle(),
    'find call',
  )
  let callerId = existing?.caller_id ?? null
  if (input.phone) callerId = (await upsertCaller(db, input.phone)).id

  const endedAt = input.endedAt ?? now.toISOString()
  const startedAt = existing?.started_at ?? (input.durationSeconds !== null ? new Date(new Date(endedAt).getTime() - input.durationSeconds * 1000).toISOString() : null)
  const afterHours = startedAt ? !isBusinessHours(new Date(startedAt), cfg.businessHours) : false

  const common = {
    caller_id: callerId, started_at: startedAt, ended_at: endedAt, duration_s: input.durationSeconds, after_hours: afterHours,
    transcript, summary, raw_payload: input.raw as object,
  }

  // The escalate tool already classified this call as a complaint in-call; don't second-guess it.
  const alreadyEscalated = existing?.outcome === 'escalated'
  if (!transcript || alreadyEscalated) {
    const call = await ensureCall(db, input.callId, alreadyEscalated ? { ...common, intent: 'complaint', outcome: 'escalated' } : common)
    if (transcript) await storeCosts(db, call.id, input.durationSeconds, transcript)
    return { callId: call.id, outcome: alreadyEscalated ? 'escalated' : (existing?.outcome ?? null), leadId: null, handoffId: null, emailed: false }
  }

  const { facts, decision } = await classify(transcript, cfg, now, opts.generate)

  // A consultation was already booked on the call (book tool created a draft lead): the in-call agent qualified it.
  // Don't silently drop a booked lead because the post-call classifier disagrees; hand it off with a note instead.
  const booked = existing
    ? must<{ id: string } | null>(await db.from('leads').select('id').eq('call_id', existing.id).maybeSingle(), 'find draft lead')
    : null
  if (booked && decision.outcome !== 'qualified' && decision.outcome !== 'qualified_with_note' && decision.outcome !== 'escalated') {
    decision.uncertainty_notes = `Booked on the call, but post-call review flagged: ${decision.decline_reason ?? decision.outcome}. ${decision.uncertainty_notes ?? ''}`.trim()
    decision.outcome = 'qualified_with_note'
    decision.decline_reason = null
  }
  const call = await ensureCall(db, input.callId, {
    ...common, language: facts.language, intent: decision.intent, outcome: decision.outcome, decline_reason: decision.decline_reason,
    summary: summary ?? facts.summary,
  })
  if (facts.caller_name || facts.caller_email) {
    if (callerId) await db.from('callers').update({ ...(facts.caller_name ? { name: facts.caller_name } : {}), ...(facts.caller_email ? { email: facts.caller_email } : {}) }).eq('id', callerId)
  }
  await storeCosts(db, call.id, input.durationSeconds, transcript)

  if (decision.outcome !== 'qualified' && decision.outcome !== 'qualified_with_note') {
    return { callId: call.id, outcome: decision.outcome, leadId: null, handoffId: null, emailed: false }
  }

  // Lead: may already exist as a draft created by the book tool.
  const leadFields = {
    call_id: call.id, caller_id: callerId, project_type: facts.project_type, location: facts.location,
    carpet_area_sqft: facts.carpet_area_sqft ? Math.round(facts.carpet_area_sqft) : null, current_state: facts.current_state,
    timeline: facts.timeline_text, budget_volunteered: facts.budget_text, source_or_referrer: facts.source_or_referrer,
    rubric_verdict: decision.rubric, uncertainty_notes: decision.uncertainty_notes, priority: decision.priority,
  }
  const lead = must<{ id: string }>(await db.from('leads').upsert(leadFields, { onConflict: 'call_id' }).select('id').single(), 'upsert lead')
  const handoffId = must<string>(await db.rpc('create_handoff', { p_lead_id: lead.id }), 'create handoff')
  const emailed = await sendHandoffEmail(db, handoffId)
  return { callId: call.id, outcome: decision.outcome, leadId: lead.id, handoffId, emailed }
}

async function storeCosts(db: Db, callRowId: string, durationSeconds: number | null, transcript: string) {
  const turns = (transcript.match(/\bAGENT:/g) ?? []).length
  const rows = computeCosts(await latestRates(db), durationSeconds, turns).map((c) => ({ call_id: callRowId, ...c }))
  if (rows.length) must(await db.from('call_costs').upsert(rows, { onConflict: 'call_id,component' }), 'store costs')
}

/** Calls we place ourselves (escalation fallback alerts to Nikhil) are not enquiries and must never become leads. */
export async function isOurOutboundCall(db: Db, callId: string): Promise<boolean> {
  if (callId.startsWith('outbound-')) return true
  const r = must<{ id: string }[]>(await db.from('escalations').select('id').eq('fallback_vaani_call_id', callId).limit(1), 'check outbound')
  return r.length > 0
}
