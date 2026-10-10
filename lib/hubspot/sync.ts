import { z } from 'zod'
import { formatIST } from '@/lib/hours'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'
import { HubspotApi, HubspotError } from './api'
import { contactProperties, dealProperties, noteBody, parseMapping, type HubspotMapping, type LeadForHubspot, type LeadStatus } from './mapping'

const hubspotEnv = () => z.object({ HUBSPOT_ACCESS_TOKEN: z.string().optional(), NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000') }).parse(process.env)
export const hubspotEnabled = () => !!hubspotEnv().HUBSPOT_ACCESS_TOKEN

export type SyncState = { contactId: string | null; dealId: string | null }
export type SyncResult = { contactId: string; dealId: string; createdDeal: boolean }

/** Pure orchestration (no DB): upsert the contact by phone, create the deal (+ one note) the first time, update stage/amount after. */
export async function syncLeadToApi(api: Pick<HubspotApi, 'findContactByPhone' | 'createContact' | 'updateContact' | 'createDeal' | 'updateDeal' | 'createNote'>,
  lead: LeadForHubspot, state: SyncState, mapping: HubspotMapping): Promise<SyncResult> {
  let contactId = state.contactId
  const cp = contactProperties(lead)
  if (!contactId && lead.phone) contactId = (await api.findContactByPhone(lead.phone))?.id ?? null
  if (contactId) {
    await api.updateContact(contactId, cp)
  } else {
    try {
      contactId = (await api.createContact(cp)).id
    } catch (e) {
      // HubSpot answers 409 when the email already belongs to a contact: "Existing ID: 123". Adopt it instead of failing.
      const m = e instanceof HubspotError && e.status === 409 ? /Existing ID:\s*(\d+)/i.exec(e.message + JSON.stringify(e.body ?? '')) : null
      if (!m) throw e
      contactId = m[1]
      await api.updateContact(contactId, cp)
    }
  }
  const dp = dealProperties(lead, mapping)
  if (state.dealId) {
    await api.updateDeal(state.dealId, dp)
    return { contactId, dealId: state.dealId, createdDeal: false }
  }
  const deal = await api.createDeal(dp, contactId)
  await api.createNote(noteBody(lead), deal.id, contactId).catch(() => undefined) // a missing note must not lose the deal
  return { contactId, dealId: deal.id, createdDeal: true }
}

async function loadLead(db: Db, leadId: string): Promise<{ lead: LeadForHubspot; callerId: string | null; state: SyncState }> {
  const l = must(await db.from('leads').select('*, callers(id,name,phone,email,hubspot_contact_id), calls(summary), consultations(slot_start,visit_type,status)').eq('id', leadId).single(), 'load lead')
  const k = (l.consultations ?? []).find((c: { status: string }) => c.status === 'booked')
  const verdict = (l.rubric_verdict ?? {}) as Record<string, { status: string; note?: string }>
  const labels: Record<string, string> = { real_project: 'Real project with execution', service_area: 'In service area', timeline: 'Realistic timeline', budget: 'Budget aligned', decision_maker: 'Decision-maker' }
  return {
    callerId: l.callers?.id ?? null,
    state: { contactId: l.callers?.hubspot_contact_id ?? null, dealId: l.hubspot_deal_id ?? null },
    lead: {
      id: l.id, status: l.status as LeadStatus, name: l.callers?.name ?? null, phone: l.callers?.phone ?? null, email: l.callers?.email ?? null,
      location: l.location, projectType: l.project_type, carpetArea: l.carpet_area_sqft, scope: l.current_state, timeline: l.timeline, budget: l.budget_volunteered,
      source: l.source_or_referrer, priority: l.priority, projectValueInr: l.project_value_inr, uncertainty: l.uncertainty_notes, summary: l.calls?.summary ?? null,
      rubric: Object.keys(labels).map((key) => ({ label: labels[key], status: verdict[key]?.status ?? 'unclear', note: verdict[key]?.note ?? null })),
      consultation: k ? { when: formatIST(k.slot_start), visitType: k.visit_type } : null,
      dashboardUrl: `${hubspotEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/dashboard/leads/${l.id}`,
    },
  }
}

/** Never throws: HubSpot trouble must never break call handling. Failures are recorded on the lead and retried by the cron. */
export async function syncLeadToHubspot(db: Db, leadId: string, api?: HubspotApi): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const token = hubspotEnv().HUBSPOT_ACCESS_TOKEN
  if (!api && !token) return { ok: true, skipped: true }
  try {
    const client = api ?? new HubspotApi(token!)
    const cfg = must<{ value: unknown } | null>(await db.from('config').select('value').eq('key', 'hubspot').maybeSingle(), 'hubspot config')
    const { lead, callerId, state } = await loadLead(db, leadId)
    const r = await syncLeadToApi(client, lead, state, parseMapping(cfg?.value))
    if (callerId) await db.from('callers').update({ hubspot_contact_id: r.contactId }).eq('id', callerId)
    await db.from('leads').update({ hubspot_deal_id: r.dealId, hubspot_status: lead.status, hubspot_value_inr: lead.projectValueInr, hubspot_synced_at: new Date().toISOString(), hubspot_error: null }).eq('id', leadId)
    return { ok: true }
  } catch (e) {
    const error = (e as Error).message.slice(0, 300)
    await db.from('leads').update({ hubspot_error: error }).eq('id', leadId)
    return { ok: false, error }
  }
}

export const isHubspotDue = (r: { status: string; project_value_inr: number | null; hubspot_status: string | null; hubspot_value_inr: number | null; hubspot_synced_at: string | null; hubspot_error: string | null }) =>
  !r.hubspot_synced_at || !!r.hubspot_error || r.hubspot_status !== r.status || Number(r.hubspot_value_inr ?? 0) !== Number(r.project_value_inr ?? 0)

/** Cron: first-time syncs that failed or were skipped, plus leads whose status/value changed since the last push. */
export async function runHubspotSync(db: Db, limit = 10): Promise<{ synced: number; failed: number }> {
  if (!hubspotEnabled()) return { synced: 0, failed: 0 }
  // "Due" is decided from what we last PUSHED (status, value), never from timestamps: the leads update trigger bumps
  // updated_at on every write, including our own bookkeeping, which would otherwise re-sync every lead every minute.
  const rows = must<{ id: string; status: string; project_value_inr: number | null; hubspot_status: string | null; hubspot_value_inr: number | null; hubspot_synced_at: string | null; hubspot_error: string | null }[]>(
    await db.from('leads').select('id,status,project_value_inr,hubspot_status,hubspot_value_inr,hubspot_synced_at,hubspot_error').order('created_at', { ascending: false }).limit(200), 'hubspot candidates')
  const due = rows.filter((r) => isHubspotDue(r)).slice(0, limit)
  let synced = 0, failed = 0
  for (const r of due) {
    if ((await syncLeadToHubspot(db, r.id)).ok) synced++
    else failed++
  }
  return { synced, failed }
}
