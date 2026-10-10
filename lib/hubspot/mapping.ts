// Pure builders: how an Aangan lead looks in HubSpot. Privacy: the note carries a SUMMARY and the rubric, never the transcript.
export type LeadStatus = 'new' | 'handed_off' | 'accepted' | 'consult_booked' | 'won' | 'lost'

export type HubspotMapping = { pipeline: string; stages: Record<LeadStatus, string> }

// Ids of HubSpot's default deals pipeline. TODO(Nikhil/HubSpot admin): confirm against the real pipeline (npm run hubspot:check).
export const DEFAULT_MAPPING: HubspotMapping = {
  pipeline: 'default',
  stages: {
    new: 'appointmentscheduled', handed_off: 'appointmentscheduled', accepted: 'qualifiedtobuy',
    consult_booked: 'presentationscheduled', won: 'closedwon', lost: 'closedlost',
  },
}

export function parseMapping(v: unknown): HubspotMapping {
  const o = (v && typeof v === 'object' ? v : {}) as { pipeline?: unknown; stages?: Record<string, unknown> }
  const stages = { ...DEFAULT_MAPPING.stages }
  for (const k of Object.keys(stages) as LeadStatus[]) if (typeof o.stages?.[k] === 'string' && o.stages[k]) stages[k] = o.stages[k] as string
  return { pipeline: typeof o.pipeline === 'string' && o.pipeline ? o.pipeline : DEFAULT_MAPPING.pipeline, stages }
}

export type LeadForHubspot = {
  id: string
  status: LeadStatus
  name: string | null
  phone: string | null
  email: string | null
  location: string | null
  projectType: string | null
  carpetArea: number | null
  scope: string | null
  timeline: string | null
  budget: string | null
  source: string | null
  priority: boolean
  projectValueInr: number | null
  uncertainty: string | null
  summary: string | null
  rubric: { label: string; status: string; note?: string | null }[]
  consultation: { when: string; visitType: string } | null
  dashboardUrl: string
}

export function splitName(name: string | null): { firstname?: string; lastname?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return {}
  return parts.length === 1 ? { firstname: parts[0] } : { firstname: parts[0], lastname: parts.slice(1).join(' ') }
}

export const contactProperties = (l: LeadForHubspot): Record<string, string> => {
  const p: Record<string, string> = { ...splitName(l.name), lifecyclestage: 'lead' }
  if (l.phone) p.phone = l.phone
  if (l.email) p.email = l.email
  return p
}

export const dealName = (l: LeadForHubspot) => `${l.priority ? '⭐ ' : ''}${l.name ?? 'Unknown'} · ${l.location ?? 'Location TBC'} · ${l.projectType ?? 'Project TBC'}`

export function dealProperties(l: LeadForHubspot, m: HubspotMapping): Record<string, string> {
  const p: Record<string, string> = { dealname: dealName(l), pipeline: m.pipeline, dealstage: m.stages[l.status] }
  if (l.projectValueInr && l.projectValueInr > 0) p.amount = String(Math.round(l.projectValueInr))
  return p
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/** HubSpot notes accept simple HTML. */
export function noteBody(l: LeadForHubspot): string {
  const rows: [string, string | null][] = [
    ['Project', l.projectType], ['Location', l.location], ['Carpet area', l.carpetArea ? `${l.carpetArea} sq ft` : null], ['Scope', l.scope], ['Timeline', l.timeline],
    ['Budget (volunteered)', l.budget], ['Source', l.source], ['Consultation', l.consultation ? `${l.consultation.when} · ${l.consultation.visitType} visit` : null],
  ]
  const checks = l.rubric.map((r) => `${r.status === 'pass' ? '✅' : '⚠️'} ${esc(r.label)}${r.note ? ` — ${esc(r.note)}` : ''}`)
  return [
    `<p><b>${l.priority ? '⭐ Priority lead' : 'New lead'} from the Aangan call agent</b></p>`,
    l.summary ? `<p>${esc(l.summary)}</p>` : '',
    `<ul>${rows.filter(([, v]) => v).map(([k, v]) => `<li>${k}: ${esc(v!)}</li>`).join('')}</ul>`,
    `<p>${checks.join('<br>')}</p>`,
    l.uncertainty ? `<p><b>Uncertainty:</b> ${esc(l.uncertainty)}</p>` : '',
    `<p><a href="${esc(l.dashboardUrl)}">Open in Aangan dashboard</a></p>`,
  ].join('')
}
