// Post-call classification. The LLM only EXTRACTS FACTS and per-criterion judgements from the transcript;
// the outcome is then decided by deterministic rules (decide()), so business rules live in config + code,
// are unit-testable, and a model slip can't silently change who gets declined.
import { z } from 'zod'
import type { AppConfig } from '@/lib/config'

const status = z.enum(['pass', 'unclear', 'fail'])
const crit = z.object({ status, note: z.string().nullable() })

export const FactsSchema = z.object({
  intent: z.enum(['new_lead', 'complaint', 'other']),
  language: z.enum(['en', 'hi', 'mr', 'other']),
  caller_hung_up_early: z.boolean(),
  caller_name: z.string().nullable(),
  caller_email: z.string().nullable(),
  caller_phone: z.string().nullable(),
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
  // A "new enquiry" that never said what, where or when (e.g. the line dropped after one sentence) is not a lead:
  // forwarding it would send a designer an empty brief.
  const unclearAll = f.rubric.real_project.status === 'unclear' && f.rubric.service_area.status === 'unclear' && f.rubric.timeline.status === 'unclear'
  if (unclearAll && !f.project_type && !f.location && f.carpet_area_sqft === null) {
    return { ...base, intent: 'other', outcome: 'abandoned', decline_reason: null }
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
  // A too-small/too-large commercial space is a SIZE decline even if the model also tagged it a generic out-of-scope.
  if (sizeFail && f.excluded_category === 'other_out_of_scope') reason = sizeFail
  else if (rubric.real_project.status === 'fail') reason = f.excluded_category === 'advice_only' ? 'advice_only' : 'out_of_scope'
  else if (rubric.service_area.status === 'fail') reason = 'area'
  else if (rubric.timeline.status === 'fail') reason = 'timeline'
  else if (rubric.budget.status === 'fail') reason = 'budget'
  else if (sizeFail) reason = sizeFail
  if (reason) return { ...base, outcome: 'declined', decline_reason: reason }

  const notes: string[] = []
  for (const [k, v] of Object.entries(rubric)) if (v.status === 'unclear' && v.note) notes.push(`${k}: ${v.note}`)
  // Only an unclear criterion 4 or 5 makes it "qualified with note" (qualified.md: record the uncertainty, don't push).
  // Gaps on 1-3 are what the agent's one direct question is for; if the caller never said, the lead still goes through and the
  // gap is shown to the designer in the rubric checklist and uncertainty text, without changing the outcome.
  const needsNote = rubric.decision_maker.status === 'unclear' || rubric.budget.status === 'unclear'

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
5 decision_maker: 'pass' when the caller speaks as the owner/occupant ("my flat", "we bought", books for themselves) or says a spouse/partner has agreed. Use 'unclear' ONLY when the caller says the decision rests with someone else who is not on the call and has not authorised them ("just checking for my parents", "just researching for my in-laws"). Not mentioning authority at all is NOT unclear.
NOT disqualifying: not knowing what they want, calling after hours, asking about price, single room with full execution, rented flat without structural change.
excluded_category: use anything other than 'none' ONLY when the caller wants a service the studio does not offer (advice only, architecture or structural work, decor only, furniture only, Vastu only, restaurant/hotel/retail/gym, any other service type). A space being too small or too large is NOT an excluded category: leave it 'none' and just report segment and carpet_area_sqft. caller_hung_up_early is true when the call ended (line dropped, caller left) before the caller described any project. For criteria the caller simply never discussed, use 'unclear' with a short note (never 'fail').
Rules: extract only what was said. Use null when unknown. NEVER invent numbers. weeks_until_needed = weeks from TODAY until the caller needs the work complete (null if not stated). volunteered_total_budget_inr must be a rupee integer (1 lakh = 100000) and only if the caller said it. If the caller is an existing client complaining about an ongoing project or their designer, intent = complaint. caller_phone: the caller's own mobile number ONLY if they said it during the call, written as digits (convert spoken digits like "nine eight seven" to numerals); otherwise null. summary: two plain sentences, no pricing talk. NEVER say a visit or consultation was booked, scheduled or confirmed: bookings are recorded separately by the system. Describe what the caller wants and, at most, which times they were offered.`

export const factsJsonSchema = () => z.toJSONSchema(FactsSchema, { target: 'draft-7' })

const geminiEnv = () => z.object({ GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is not set'), GEMINI_MODEL: z.string().default('gemini-3.8-flash') }).parse(process.env)

/** Gemini generateContent with JSON-schema output. Retries rate limits / transient 5xx with backoff. */
async function geminiGenerate(prompt: string, schema: object): Promise<unknown> {
  const e = geminiEnv() // only what this call needs; unrelated secrets are not required
  let lastErr = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)))
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${e.GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: schema },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.ok) {
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
      if (!text) { lastErr = 'Gemini returned no content'; continue }
      return JSON.parse(text)
    }
    lastErr = `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`
    if (![429, 500, 502, 503, 504].includes(res.status)) break
  }
  throw new Error(lastErr)
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
