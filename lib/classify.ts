// Post-call classification. The LLM only EXTRACTS FACTS and per-criterion judgements from the transcript;
// the outcome is then decided by deterministic rules (decide()), so business rules live in config + code,
// are unit-testable, and a model slip can't silently change who gets declined.
import { z } from 'zod'
import { env } from '@/lib/env'
import type { AppConfig } from '@/lib/config'

const status = z.enum(['pass', 'unclear', 'fail'])
const crit = z.object({ status, note: z.string().nullable() })

export const FactsSchema = z.object({
  intent: z.enum(['new_lead', 'complaint', 'other']),
  language: z.enum(['en', 'hi', 'mr', 'other']),
  caller_hung_up_early: z.boolean(),
  caller_name: z.string().nullable(),
  caller_email: z.string().nullable(),
  segment: z.enum(['residential', 'commercial', 'unknown']),
  excluded_category: z.enum(['none', 'advice_only', 'architecture_structural', 'decor_only', 'furniture_only', 'vastu_only', 'restaurant_hotel_retail_gym', 'other_out_of_scope']),
  project_type: z.string().nullable(),
  location: z.string().nullable(),
  carpet_area_sqft: z.number().nullable(),
  current_state: z.string().nullable(),
  timeline_text: z.string().nullable(),
  weeks_until_needed: z.number().nullable(),
  budget_text: z.string().nullable(),
  volunteered_total_budget_inr: z.number().nullable(),
  source_or_referrer: z.string().nullable(),
  referrer_personally_knows_nikhil: z.boolean(),
  complaint_summary: z.string().nullable(),
  rubric: z.object({
    real_project: crit,
    service_area: crit,
    timeline: crit,
    budget: crit,
    decision_maker: crit,
  }),
  summary: z.string(),
})
export type Facts = z.infer<typeof FactsSchema>

export type Decision = {
  intent: Facts['intent']
  outcome: 'qualified' | 'qualified_with_note' | 'declined' | 'escalated' | 'abandoned'
  decline_reason: 'area' | 'advice_only' | 'timeline' | 'budget' | 'too_small' | 'too_large' | 'out_of_scope' | 'other' | null
  priority: boolean
  uncertainty_notes: string | null
  rubric: Record<keyof Facts['rubric'], { status: 'pass' | 'unclear' | 'fail'; note: string | null }>
}

/** Deterministic business rules over extracted facts. Never sees pricing data. */
export function decide(f: Facts, cfg: AppConfig): Decision {
  const rubric = structuredClone(f.rubric) as Decision['rubric']
  const base = { intent: f.intent, priority: false, uncertainty_notes: null as string | null, rubric }

  if (f.intent === 'complaint') return { ...base, outcome: 'escalated', decline_reason: null }
  if (f.intent === 'other') {
    return { ...base, outcome: f.caller_hung_up_early ? 'abandoned' : 'declined', decline_reason: f.caller_hung_up_early ? null : 'other' }
  }

  // Hard facts override the model's soft judgement.
  if (f.excluded_category !== 'none') {
    rubric.real_project = { status: 'fail', note: f.excluded_category }
  }
  if (f.weeks_until_needed !== null) {
    if (f.weeks_until_needed < cfg.minCompletionWeeks) {
      rubric.timeline = { status: 'fail', note: `needs completion in ~${f.weeks_until_needed} weeks (minimum ${cfg.minCompletionWeeks})` }
    } else if (rubric.timeline.status === 'fail') {
      rubric.timeline = { status: 'pass', note: rubric.timeline.note }
    }
  }
  const withExecution = rubric.real_project.status !== 'fail'
  if (f.volunteered_total_budget_inr !== null && withExecution) {
    if (f.volunteered_total_budget_inr < cfg.budgetFloorInr) {
      rubric.budget = { status: 'fail', note: 'volunteered budget is below what such a project needs' }
    } else if (rubric.budget.status === 'fail') {
      rubric.budget = { status: 'pass', note: rubric.budget.note }
    }
  }
  // Criteria 4 and 5 never decline unless the volunteered budget clearly fails (qualified.md).
  if (rubric.decision_maker.status === 'fail') rubric.decision_maker = { ...rubric.decision_maker, status: 'unclear' }

  let sizeFail: 'too_small' | 'too_large' | null = null
  if (f.segment === 'commercial' && f.carpet_area_sqft !== null) {
    if (f.carpet_area_sqft < cfg.commercialMinSqft) sizeFail = 'too_small'
    else if (f.carpet_area_sqft > cfg.commercialMaxSqft) sizeFail = 'too_large'
  }

  let reason: Decision['decline_reason'] = null
  if (rubric.real_project.status === 'fail') reason = f.excluded_category === 'advice_only' ? 'advice_only' : 'out_of_scope'
  else if (rubric.service_area.status === 'fail') reason = 'area'
  else if (rubric.timeline.status === 'fail') reason = 'timeline'
  else if (rubric.budget.status === 'fail') reason = 'budget'
  else if (sizeFail) reason = sizeFail
  if (reason) return { ...base, outcome: 'declined', decline_reason: reason }

  const notes: string[] = []
  for (const [k, v] of Object.entries(rubric)) if (v.status === 'unclear' && v.note) notes.push(`${k}: ${v.note}`)
  const needsNote =
    rubric.decision_maker.status === 'unclear' || rubric.budget.status === 'unclear' ||
    rubric.real_project.status === 'unclear' || rubric.service_area.status === 'unclear' || rubric.timeline.status === 'unclear'

  const priority =
    f.referrer_personally_knows_nikhil ||
    (f.segment === 'residential' && (f.carpet_area_sqft ?? 0) >= cfg.largeResidentialSqft)

  return {
    ...base,
    outcome: needsNote ? 'qualified_with_note' : 'qualified',
    decline_reason: null,
    priority,
    uncertainty_notes: notes.length ? notes.join('; ') : null,
  }
}

// ---------------------------------------------------------------------------------------------- LLM call

export type GenerateJson = (prompt: string, schema: object) => Promise<unknown>

const RUBRIC_PROMPT = `You extract facts from a phone-call transcript for Aangan Studio, an interior design studio in Pune.
Studio facts: end-to-end interior design WITH execution for residential (2BHK+, floors, or single rooms as complete redesign with execution) and small commercial (offices, clinics, studios up to ~3,000 sq ft). Service area: Pune city and PCMC (Kothrud, Baner, Aundh, Wakad, Koregaon Park, Kalyani Nagar, Viman Nagar, Hadapsar, Magarpatta, NIBM, Kondhwa, Undri, Shivane, Warje, Erandwane, Deccan, Pimpri, Chinchwad, Pimple Saudagar, Pimple Nilakh, Ravet, Hinjewadi, Kharadi and adjoining areas). NOT served: Nashik, Mumbai, Talegaon, Lonavala, other cities. Not offered: architecture/structural work, decor-only/styling advice, standalone furniture, standalone Vastu, restaurants/hotels/retail/gyms.
Rubric (judge each as pass / unclear / fail):
1 real_project: wants design AND execution, not just advice or ideas.
2 service_area: site in Pune/PCMC.
3 timeline: execution feasible; fail only if needed in under ~8 weeks.
4 budget: pass if no budget mentioned. Only judge when the caller VOLUNTEERED a number.
5 decision_maker: caller decides or is authorised. "Just researching for in-laws" = unclear.
NOT disqualifying: not knowing what they want, calling after hours, asking about price, single room with full execution, rented flat without structural change.
Rules: extract only what was said. Use null when unknown. NEVER invent numbers. weeks_until_needed = weeks from TODAY until the caller needs the work complete (null if not stated). volunteered_total_budget_inr must be a rupee integer (1 lakh = 100000) and only if the caller said it. If the caller is an existing client complaining about an ongoing project or their designer, intent = complaint. summary: two plain sentences, no pricing talk.`

export const factsJsonSchema = () => z.toJSONSchema(FactsSchema, { target: 'draft-7' })

async function geminiGenerate(prompt: string, schema: object): Promise<unknown> {
  const e = env()
  if (!e.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${e.GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: schema },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned no content')
  return JSON.parse(text)
}

export async function extractFacts(
  transcript: string,
  now: Date,
  generate: GenerateJson = geminiGenerate,
): Promise<Facts> {
  const prompt = `${RUBRIC_PROMPT}\n\nTODAY: ${now.toISOString().slice(0, 10)}\n\nTRANSCRIPT:\n"""\n${transcript}\n"""`
  const raw = await generate(prompt, factsJsonSchema())
  return FactsSchema.parse(raw)
}

export async function classify(transcript: string, cfg: AppConfig, now = new Date(), generate?: GenerateJson) {
  const facts = await extractFacts(transcript, now, generate)
  return { facts, decision: decide(facts, cfg) }
}
