import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'
import { resolveRange, startOfIstMonth, type Resolved } from '@/lib/dashboard/range'

export type Filters = { range: Resolved; afterHoursOnly: boolean; outcome: string | null; raw: Record<string, string | undefined> }

const OUTCOMES = ['qualified', 'qualified_with_note', 'declined', 'escalated', 'abandoned']
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseFilters(sp: Record<string, string | string[] | undefined>, now = new Date()): Filters {
  const raw = { range: one(sp.range), from: one(sp.from), to: one(sp.to), ah: one(sp.ah), outcome: one(sp.outcome) }
  const outcome = raw.outcome && OUTCOMES.includes(raw.outcome) ? raw.outcome : null
  return { range: resolveRange(raw, now), afterHoursOnly: raw.ah === '1', outcome, raw }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Metrics = Record<string, any>

export async function getMetrics(db: Db, f: Filters): Promise<Metrics> {
  return must(await db.rpc('dashboard_metrics', {
    p_from: f.range.from.toISOString(), p_to: f.range.to.toISOString(), p_after_hours_only: f.afterHoursOnly, p_outcome: f.outcome,
  }), 'dashboard metrics')
}

/** The headline is always month-to-date and ignores the page filters. */
export async function getHeadline(db: Db, now = new Date()): Promise<Metrics> {
  return must(await db.rpc('dashboard_metrics', {
    p_from: startOfIstMonth(now).toISOString(), p_to: new Date(now.getTime() + 60_000).toISOString(), p_after_hours_only: false, p_outcome: null,
  }), 'headline metrics')
}

const inRange = (f: Filters) => {
  const a = f.range.from.toISOString(), b = f.range.to.toISOString()
  return `and(started_at.gte.${a},started_at.lt.${b}),and(started_at.is.null,created_at.gte.${a},created_at.lt.${b})`
}

export async function recentCalls(db: Db, f: Filters, limit = 25) {
  let q = db.from('calls').select('id,vaani_call_id,started_at,created_at,duration_s,after_hours,language,outcome,decline_reason,summary,callers(name,phone)')
    .or(inRange(f)).order('created_at', { ascending: false }).limit(limit)
  if (f.afterHoursOnly) q = q.eq('after_hours', true)
  if (f.outcome) q = q.eq('outcome', f.outcome)
  return must<any[]>(await q, 'recent calls')
}

export async function recentLeads(db: Db, f: Filters, limit = 25) {
  // Leads follow their call's filters: resolve the call ids first (RLS keeps this admin-only).
  const calls = await recentCalls(db, f, 200)
  const ids = calls.map((c) => c.id)
  if (!ids.length) return []
  return must<any[]>(await db.from('leads')
    .select('id,project_type,location,carpet_area_sqft,status,priority,project_value_inr,created_at,callers(name),consultations(slot_start,visit_type,status),calls(after_hours)')
    .in('call_id', ids).order('created_at', { ascending: false }).limit(limit), 'recent leads')
}

export async function recentBounces(db: Db, limit = 5) {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  return must<any[]>(await db.from('email_events').select('email_message_id,occurred_at,payload').eq('type', 'bounced').gte('occurred_at', since)
    .order('occurred_at', { ascending: false }).limit(limit), 'bounces')
}
