import { describe, expect, it } from 'vitest'
import { classify, decide, type Facts } from '@/lib/classify'
import { DEFAULT_CONFIG } from '@/lib/config'

const pass = { status: 'pass' as const, note: null }
const base = (o: Partial<Facts> = {}): Facts => ({
  intent: 'new_lead', language: 'en', caller_hung_up_early: false, caller_name: null, caller_email: null, segment: 'residential',
  excluded_category: 'none', project_type: '3BHK full redesign', location: 'Kothrud', carpet_area_sqft: 1400, current_state: null,
  timeline_text: null, weeks_until_needed: 20, budget_text: null, volunteered_total_budget_inr: null, source_or_referrer: null,
  referrer_personally_knows_nikhil: false, complaint_summary: null,
  rubric: { real_project: pass, service_area: pass, timeline: pass, budget: pass, decision_maker: pass }, summary: 's', ...o,
})
const cfg = DEFAULT_CONFIG

describe('decide(): outcomes from the founder rubric', () => {
  it('T01-style: plain qualified, referral from a client is not priority', () => {
    const d = decide(base({ source_or_referrer: 'Shruti Joshi' }), cfg)
    expect(d).toMatchObject({ outcome: 'qualified', decline_reason: null, priority: false })
  })
  it('T05-style: friend of Nikhil -> priority', () =>
    expect(decide(base({ referrer_personally_knows_nikhil: true, carpet_area_sqft: 2400 }), cfg).priority).toBe(true))
  it('large residential (3,000+ sq ft) -> priority; large commercial is not', () => {
    expect(decide(base({ carpet_area_sqft: 3200 }), cfg).priority).toBe(true)
    expect(decide(base({ segment: 'commercial', carpet_area_sqft: 2900 }), cfg).priority).toBe(false)
  })
  it('T03: outside Pune/PCMC -> declined: area', () =>
    expect(decide(base({ rubric: { ...base().rubric, service_area: { status: 'fail', note: 'Nashik' } } }), cfg))
      .toMatchObject({ outcome: 'declined', decline_reason: 'area' }))
  it('T04: advice only -> declined: advice_only', () =>
    expect(decide(base({ excluded_category: 'advice_only' }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'advice_only' }))
  it('T19: restaurant -> declined: out_of_scope', () =>
    expect(decide(base({ excluded_category: 'restaurant_hotel_retail_gym' }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'out_of_scope' }))
  it('T07: needed in 3 weeks -> declined: timeline (threshold comes from config)', () => {
    expect(decide(base({ weeks_until_needed: 3 }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'timeline' })
    expect(decide(base({ weeks_until_needed: 7 }), cfg).decline_reason).toBe('timeline')
    expect(decide(base({ weeks_until_needed: 7 }), { ...cfg, minCompletionWeeks: 6 }).outcome).toBe('qualified')
  })
  it('T10: volunteered ₹1-1.5 lakh for kitchen + bedroom -> declined: budget', () =>
    expect(decide(base({ volunteered_total_budget_inr: 150000 }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'budget' }))
  it('budget at or above the floor is fine; no budget is fine', () => {
    expect(decide(base({ volunteered_total_budget_inr: 800000 }), cfg).outcome).toBe('qualified')
    expect(decide(base({ volunteered_total_budget_inr: null }), cfg).outcome).toBe('qualified')
  })
  it('T18: small commercial -> too_small; oversized -> too_large', () => {
    expect(decide(base({ segment: 'commercial', carpet_area_sqft: 300 }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'too_small' })
    expect(decide(base({ segment: 'commercial', carpet_area_sqft: 5000 }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'too_large' })
    expect(decide(base({ segment: 'residential', carpet_area_sqft: 300 }), cfg).outcome).toBe('qualified') // single room is fine
  })
  it('T14-style: unclear decision-maker -> qualified_with_note, never declined', () => {
    const d = decide(base({ rubric: { ...base().rubric, decision_maker: { status: 'unclear', note: 'researching for in-laws' } } }), cfg)
    expect(d).toMatchObject({ outcome: 'qualified_with_note', decline_reason: null })
    expect(d.uncertainty_notes).toContain('in-laws')
  })
  it('a model "fail" on decision-maker is downgraded: criteria 4/5 never decline', () =>
    expect(decide(base({ rubric: { ...base().rubric, decision_maker: { status: 'fail', note: 'x' } } }), cfg).outcome).toBe('qualified_with_note'))
  it('rented flat, no price-asking penalty, after-hours: none of these decline (no inputs for them)', () =>
    expect(decide(base(), cfg).outcome).toBe('qualified'))
  it('T09: complaint -> escalated, no lead logic', () =>
    expect(decide(base({ intent: 'complaint' }), cfg)).toMatchObject({ outcome: 'escalated', decline_reason: null }))
  it('dropped caller -> abandoned; other chatter -> declined: other', () => {
    expect(decide(base({ intent: 'other', caller_hung_up_early: true }), cfg).outcome).toBe('abandoned')
    expect(decide(base({ intent: 'other' }), cfg)).toMatchObject({ outcome: 'declined', decline_reason: 'other' })
  })
  it('model-reported budget "fail" is overridden when the number actually clears the floor', () =>
    expect(decide(base({ volunteered_total_budget_inr: 900000, rubric: { ...base().rubric, budget: { status: 'fail', note: 'model slip' } } }), cfg).outcome).toBe('qualified'))
})

describe('classify() with an injected model', () => {
  it('validates the model output against the schema', async () => {
    await expect(classify('x', cfg, new Date(), async () => ({ intent: 'new_lead' }))).rejects.toThrow()
  })
  it('passes the rubric prompt and no pricing material to the model', async () => {
    let seen = ''
    await classify('AGENT: hi', cfg, new Date('2026-10-10'), async (p) => { seen = p; return base() })
    expect(seen).toContain('TODAY: 2026-10-10')
    expect(seen).not.toMatch(/₹\s?\d|per sq\.? ?ft|starts at/i)
  })
})
