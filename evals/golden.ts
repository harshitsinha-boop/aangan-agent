// Hand-extracted facts for each phone transcript: what a PERFECT extraction step would return. They exercise the decision
// rules (lib/classify.ts decide) deterministically, with no LLM and no network, so CI always has a floor. The live eval
// (evals/run-classification.ts) checks the real model's extraction against the same expected outcomes.
import type { Facts } from '../lib/classify'

const ok = { status: 'pass' as const, note: null }
const base = (o: Partial<Facts>): Facts => ({
  intent: 'new_lead', language: 'en', caller_hung_up_early: false, caller_name: null, caller_email: null, segment: 'residential',
  excluded_category: 'none', project_type: null, location: null, carpet_area_sqft: null, current_state: null, timeline_text: null,
  weeks_until_needed: null, budget_text: null, volunteered_total_budget_inr: null, source_or_referrer: null,
  referrer_personally_knows_nikhil: false, complaint_summary: null,
  rubric: { real_project: ok, service_area: ok, timeline: ok, budget: ok, decision_maker: ok }, summary: '', ...o,
})
const fail = (note: string) => ({ status: 'fail' as const, note })
const unclear = (note: string) => ({ status: 'unclear' as const, note })

export const GOLDEN: Record<string, Facts> = {
  T01: base({ caller_name: 'Priya', project_type: '3BHK full redesign', location: 'Kothrud', carpet_area_sqft: 1400, weeks_until_needed: 26, timeline_text: 'By March, no rush', source_or_referrer: 'Shruti Joshi (past client, Aundh)' }),
  T02: base({ project_type: '2BHK full redesign', location: 'Wakad', carpet_area_sqft: 950, weeks_until_needed: 9, timeline_text: 'Move in November, design from October', source_or_referrer: 'Instagram' }),
  T03: base({ caller_name: 'Suresh Patil', project_type: 'Home office and study', location: 'Nashik', rubric: { real_project: ok, service_area: fail('Nashik'), timeline: ok, budget: ok, decision_maker: ok } }),
  T04: base({ project_type: 'Living room ideas', location: null, excluded_category: 'advice_only', rubric: { real_project: fail('advice only'), service_area: unclear('not stated'), timeline: ok, budget: ok, decision_maker: ok } }),
  T05: base({ caller_name: 'Aarti Mehta', project_type: '4BHK complete redesign', location: 'Koregaon Park', carpet_area_sqft: 2400, weeks_until_needed: 17, timeline_text: 'Move back by February', source_or_referrer: 'Vikram Agarwal, close friend of Nikhil', referrer_personally_knows_nikhil: true }),
  T06: base({ segment: 'commercial', project_type: 'Startup office fitout', location: 'Baner', carpet_area_sqft: 800, current_state: 'Bare shell', weeks_until_needed: 13, timeline_text: 'Operational by December' }),
  T07: base({ project_type: 'Living room and kitchen', weeks_until_needed: 3, timeline_text: 'Before Diwali', rubric: { real_project: ok, service_area: unclear('not stated'), timeline: fail('about 3 weeks'), budget: ok, decision_maker: ok } }),
  T09: base({ intent: 'complaint', caller_name: 'Sheetal Deshpande', project_type: '2BHK, Viman Nagar', complaint_summary: 'Designer Aryan has not replied in five days' }),
  T10: base({ project_type: 'Kitchen and one bedroom', location: 'Kharadi', carpet_area_sqft: 550, budget_text: '1 to 1.5 lakh maximum', volunteered_total_budget_inr: 150000, rubric: { real_project: ok, service_area: ok, timeline: ok, budget: fail('far below scope'), decision_maker: ok } }),
  T11: base({ project_type: 'Living room, bedroom, kitchen (rented 2BHK)', location: 'Baner', current_state: 'Rented, 3-year lease, no structural change' }),
  T12: base({ caller_name: 'Anand Sharma', project_type: 'Villa, ground plus two floors', location: 'Kalyani Nagar', carpet_area_sqft: 5500, current_state: 'New construction, empty', weeks_until_needed: 25, timeline_text: 'March next year' }),
  T13: base({ project_type: '3BHK kitchen, wardrobes, living room', location: 'Aundh', carpet_area_sqft: 1100 }),
  T14: base({ project_type: '3BHK (parents\' flat)', location: 'Hadapsar', current_state: 'New possession', rubric: { real_project: ok, service_area: ok, timeline: ok, budget: ok, decision_maker: unclear('caller is the son; parents decide and will attend the consultation') } }),
  T15: base({ caller_name: 'Smita', project_type: '2BHK full home', location: 'Undri', carpet_area_sqft: 875, current_state: 'Possession in about six weeks; builder will allow site entry', timeline_text: 'Possession in six weeks, start design now' }),
  T16: base({ caller_name: 'Girish Nair', project_type: '3BHK', location: 'Viman Nagar', complaint_summary: null }),
  T17a: base({ intent: 'other', caller_hung_up_early: true, rubric: { real_project: unclear('line dropped'), service_area: unclear('line dropped'), timeline: unclear('line dropped'), budget: ok, decision_maker: ok } }),
  T17b: base({ caller_name: 'Ritu Kapoor', project_type: '3BHK full home', location: 'Pimple Saudagar', carpet_area_sqft: 1050, weeks_until_needed: 26, timeline_text: 'Done by March' }),
  T18: base({ segment: 'commercial', project_type: 'Coworking pod', carpet_area_sqft: 180 }),
  T19: base({ segment: 'commercial', project_type: 'Restaurant', location: 'Koregaon Park', excluded_category: 'restaurant_hotel_retail_gym', rubric: { real_project: fail('restaurant'), service_area: ok, timeline: ok, budget: ok, decision_maker: ok } }),
  T20: base({ caller_name: 'Pooja', project_type: '2BHK kitchen, bedrooms, living room', location: 'Magarpatta', carpet_area_sqft: 900, weeks_until_needed: 16, timeline_text: 'January start for execution' }),
}
