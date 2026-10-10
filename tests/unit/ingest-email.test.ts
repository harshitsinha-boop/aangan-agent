import { describe, expect, it } from 'vitest'
import { confirmationEmail, escalationEmail, handoffEmail, reminderEmail, type HandoffData } from '@/lib/email/compose'
import { computeCosts, normalizePostprocessing } from '@/lib/ingest'

describe('normalizePostprocessing', () => {
  const body = {
    event: 'call_postprocessing', timestamp: '2026-10-10T20:05:00+00:00',
    data: { call_id: 'inbound-1', call_duration: 125_400, summary: 'sum', transcript: 'AGENT: hi', recording_url: 'https://r', phone_number: '098765 43210' },
  }
  it('converts ms -> s and normalises the phone', () => {
    const d = normalizePostprocessing(body)!
    expect(d).toMatchObject({ callId: 'inbound-1', durationSeconds: 125.4, phone: '+919876543210', summary: 'sum' })
  })
  it('returns null without a call id', () => expect(normalizePostprocessing({ event: 'x', data: {} })).toBeNull())
})

describe('computeCosts', () => {
  it('units x rate per component; zero rates give zero, never invented costs', () => {
    const rates = [{ component: 'telephony_min', inr_per_unit: 1.5 }, { component: 'llm_call', inr_per_unit: 0.2 }, { component: 'email', inr_per_unit: 0.1 }]
    const c = computeCosts(rates, 120, 10)
    expect(c).toEqual([{ component: 'telephony_min', units: 2, inr: 3 }, { component: 'llm_call', units: 10, inr: 2 }])
    expect(computeCosts([{ component: 'tts_min', inr_per_unit: 0 }], 600, 5)[0].inr).toBe(0)
  })
})

const lead: HandoffData = {
  name: 'Priya', phone: '+919812345678', location: 'Kothrud', projectType: '3BHK full redesign', carpetArea: 1400, scope: 'Kitchen, living, 2 bedrooms',
  timeline: 'By March', budget: null, source: 'Shruti Joshi', rubric: [{ label: 'Real project', status: 'pass' }, { label: 'Decision-maker', status: 'unclear', note: 'husband agrees' }],
  uncertainty: 'Spouse not on the call', consultation: { when: 'Sat 17 Oct, 6:00 pm', visitType: 'site' }, summary: 'Wants a full redesign.',
  priority: false, acceptUrl: 'https://a/api/actions/AAA', reassignUrl: 'https://a/api/actions/BBB', dashboardUrl: 'https://a/dashboard/leads/1',
}

describe('emails respect privacy (DPDP) and the brief', () => {
  it('handoff: subject format, priority prefix, three buttons', () => {
    expect(handoffEmail(lead).subject).toBe('New lead: Priya · Kothrud · 3BHK full redesign')
    expect(handoffEmail({ ...lead, priority: true }).subject).toBe('⭐ Priority: New lead: Priya · Kothrud · 3BHK full redesign')
    const { html } = handoffEmail(lead)
    for (const label of ['Accept', 'Reassign', 'Open in dashboard']) expect(html).toContain(label)
    expect(html).toContain('✅'); expect(html).toContain('⚠️')
  })
  it('handoff + reminder: last 4 digits only, no transcript', () => {
    for (const m of [handoffEmail(lead), reminderEmail({ ...lead, hoursWaiting: 2 })]) {
      for (const s of [m.html, m.text]) {
        expect(s).not.toContain('9812345678'); expect(s).not.toContain('+91')
        expect(s).toContain('5678')
        expect(s).not.toMatch(/AGENT:|USER:|transcript/i)
      }
    }
  })
  it('escalation: URGENT subject, Acknowledge button', () => {
    const m = escalationEmail({ name: 'Sheetal Deshpande', project: '2BHK Viman Nagar', designer: 'Aryan', issue: 'No reply in 5 days', calledAt: 'Wed 11:32 am', callbackMinutes: 15, acknowledgeUrl: 'https://a/x', dashboardUrl: 'https://a/d' })
    expect(m.subject).toBe('URGENT: Existing client · Sheetal Deshpande · callback within 15 min')
    expect(m.html).toContain('Acknowledge')
  })
  it('caller confirmation: no pricing language, first name only', () => {
    const m = confirmationEmail({ name: 'Priya', when: 'Sat 17 Oct, 6:00 pm', visitType: 'studio', designerFirstName: 'Aryan', studioAddress: 'Studio, Pune' })
    expect(m.html).toContain('Aryan'); expect(m.html).not.toMatch(/₹|lakh|price|pricing|cost|rate/i)
  })
  it('escapes HTML in caller-supplied values', () =>
    expect(handoffEmail({ ...lead, name: '<script>alert(1)</script>' }).html).not.toContain('<script>'))
})
