import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { confirmationEmail, escalationEmail, handoffEmail, reminderEmail, type HandoffData } from '@/lib/email/compose'

const lead: HandoffData = {
  name: 'Priya', phone: '+919812345678', location: 'Kothrud', projectType: '3BHK full redesign', carpetArea: 1400, scope: 'Kitchen, living, 2 bedrooms',
  timeline: 'By March', budget: null, source: 'Shruti Joshi',
  rubric: [{ label: 'Real project with execution', status: 'pass' }, { label: 'Decision-maker on the call', status: 'unclear', note: 'husband agrees' }],
  uncertainty: 'Spouse not on the call', consultation: { when: 'Sat 17 Oct, 6:00 pm', visitType: 'site' }, summary: 'Wants a full redesign of a 3BHK.',
  priority: false, acceptUrl: 'https://app.test/api/actions/AAA', reassignUrl: 'https://app.test/api/actions/BBB', dashboardUrl: 'https://app.test/dashboard/leads/1',
}
const esc = {
  name: 'Sheetal Deshpande', project: '2BHK Viman Nagar', designer: 'Aryan', issue: 'No reply in 5 days', calledAt: 'Wed 11:32 am',
  callbackMinutes: 15, acknowledgeUrl: 'https://app.test/api/actions/CCC', dashboardUrl: 'https://app.test/dashboard/escalations',
}
const conf = { name: 'Priya', when: 'Sat 17 Oct, 6:00 pm', visitType: 'studio' as const, designerFirstName: 'Aryan', studioAddress: '14 Example Lane, Kothrud' }
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

describe('handoff email', () => {
  it('subject follows the brief, with the priority prefix', async () => {
    expect((await handoffEmail(lead)).subject).toBe('New lead: Priya · Kothrud · 3BHK full redesign')
    expect((await handoffEmail({ ...lead, priority: true })).subject).toBe('⭐ Priority: New lead: Priya · Kothrud · 3BHK full redesign')
  })
  it('has Accept, Reassign and Open in dashboard pointing at the right links', async () => {
    const { html, text } = await handoffEmail(lead)
    for (const l of ['Accept', 'Reassign', 'Open in dashboard']) { expect(html).toContain(l); expect(text).toContain(l) }
    expect(hrefs(html)).toEqual(expect.arrayContaining([lead.acceptUrl, lead.reassignUrl, lead.dashboardUrl]))
  })
  it('shows the rubric with ✅ / ⚠️, the uncertainty note, booking and summary', async () => {
    const { html } = await handoffEmail(lead)
    for (const s of ['✅', '⚠️', 'Spouse not on the call', 'Sat 17 Oct, 6:00 pm', 'site visit', 'Wants a full redesign', '1400 sq ft', 'Shruti Joshi']) expect(html).toContain(s)
  })
  it('omits budget when not volunteered and shows it when volunteered', async () => {
    expect((await handoffEmail(lead)).html).not.toContain('Budget')
    expect((await handoffEmail({ ...lead, budget: 'around five lakh' })).html).toContain('Budget (volunteered)')
  })
  it('renders sensibly with every optional field missing', async () => {
    const m = await handoffEmail({ ...lead, name: null, location: null, projectType: null, carpetArea: null, scope: null, timeline: null, source: null, uncertainty: null, consultation: null, phone: null })
    expect(m.subject).toBe('New lead: Unknown · Location TBC · Project TBC')
    expect(m.html).toContain('Not booked yet')
  })
})

describe('privacy (DPDP): summary + dashboard link only', () => {
  const all = async () => [
    await handoffEmail(lead), await handoffEmail({ ...lead, priority: true }), await reminderEmail({ ...lead, hoursWaiting: 2.4 }),
    await escalationEmail(esc), await confirmationEmail(conf),
  ]
  it('no full phone number, no country code, in any render (html or text)', async () => {
    for (const m of await all()) for (const s of [m.html, m.text, m.subject]) { expect(s).not.toContain('9812345678'); expect(s).not.toContain('+91') }
    for (const m of [await handoffEmail(lead), await reminderEmail({ ...lead, hoursWaiting: 1 })]) expect(m.html).toContain('5678')
  })
  it('no transcript content or transcript labels in any render', async () => {
    for (const m of await all()) for (const s of [m.html, m.text]) expect(s).not.toMatch(/AGENT:|USER:|transcript/i)
  })
  it('the sender code never loads the transcript column', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'notify.ts'), 'utf8')
    expect(src).not.toMatch(/transcript/i)
  })
  it('caller-supplied text is HTML-escaped', async () => {
    const m = await handoffEmail({ ...lead, name: '<script>alert(1)</script>', summary: '"><img src=x onerror=alert(1)>' })
    expect(m.html).not.toContain('<script>'); expect(m.html).not.toContain('<img src=x')
  })
})

describe('reminder email', () => {
  it('prefixes the subject and explains the reassignment consequence', async () => {
    const m = await reminderEmail({ ...lead, hoursWaiting: 2.4 })
    expect(m.subject).toBe('Reminder: New lead: Priya · Kothrud · 3BHK full redesign')
    expect(m.html).toMatch(/2\.4(<!-- -->)?h/); expect(m.html).toMatch(/reassigned to the principal/)
  })
})

describe('escalation email', () => {
  it('URGENT subject per the brief and a single Acknowledge action', async () => {
    const m = await escalationEmail(esc)
    expect(m.subject).toBe('URGENT: Existing client · Sheetal Deshpande · callback within 15 min')
    expect(m.html).toContain('Acknowledge')
    expect(hrefs(m.html)).toContain(esc.acknowledgeUrl)
    expect(m.text).toContain(esc.acknowledgeUrl)
  })
  it('carries name, project, designer, issue and time', async () => {
    const { html } = await escalationEmail(esc)
    for (const s of ['Sheetal Deshpande', '2BHK Viman Nagar', 'Aryan', 'No reply in 5 days', 'Wed 11:32 am']) expect(html).toContain(s)
  })
})

describe('caller confirmation', () => {
  it('has date, time, visit type, designer first name and studio address; no pricing language', async () => {
    const { html, text, subject } = await confirmationEmail(conf)
    for (const s of ['Sat 17 Oct, 6:00 pm', 'Studio visit', 'Aryan', '14 Example Lane, Kothrud']) expect(html).toContain(s)
    for (const s of [html, text, subject]) expect(s).not.toMatch(/₹|lakh|pric|cost|\brates?\b|quote|fee|free/i)
  })
  it('site visit shows the site note instead of the studio address', async () => {
    const { html } = await confirmationEmail({ ...conf, visitType: 'site' })
    expect(html).toContain('Site visit'); expect(html).toContain('will visit your site'); expect(html).not.toContain('14 Example Lane')
  })
  it('does not leak designer surname or phone', async () => expect((await confirmationEmail(conf)).html).not.toMatch(/Deshpande|\+91|\d{10}/))
})
