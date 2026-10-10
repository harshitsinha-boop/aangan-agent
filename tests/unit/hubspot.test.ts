import { describe, expect, it, vi } from 'vitest'
import { HubspotApi, HubspotError } from '@/lib/hubspot/api'
import { contactProperties, dealName, dealProperties, DEFAULT_MAPPING, noteBody, parseMapping, splitName, type LeadForHubspot } from '@/lib/hubspot/mapping'
import { isHubspotDue, syncLeadToApi } from '@/lib/hubspot/sync'

const lead: LeadForHubspot = {
  id: 'L1', status: 'consult_booked', name: 'Priya Kulkarni', phone: '+919812345678', email: 'priya@example.com', location: 'Kothrud', projectType: '3BHK full redesign',
  carpetArea: 1400, scope: 'Kitchen, living, 2 bedrooms', timeline: 'By March', budget: null, source: 'Shruti Joshi', priority: false, projectValueInr: 850000,
  uncertainty: 'Spouse not on call', summary: 'Wants a full redesign of a 3BHK.', rubric: [{ label: 'Real project', status: 'pass' }, { label: 'Decision-maker', status: 'unclear', note: 'husband agrees' }],
  consultation: { when: 'Sat 17 Oct, 6:00 pm', visitType: 'site' }, dashboardUrl: 'https://app.test/dashboard/leads/L1',
}

describe('mapping', () => {
  it('splits names', () => {
    expect(splitName('Priya Kulkarni')).toEqual({ firstname: 'Priya', lastname: 'Kulkarni' })
    expect(splitName('Madonna')).toEqual({ firstname: 'Madonna' })
    expect(splitName('  Anand  Kumar Sharma ')).toEqual({ firstname: 'Anand', lastname: 'Kumar Sharma' })
    expect(splitName(null)).toEqual({})
  })
  it('contact has name, phone (E.164), email, lead lifecycle', () =>
    expect(contactProperties(lead)).toEqual({ firstname: 'Priya', lastname: 'Kulkarni', phone: '+919812345678', email: 'priya@example.com', lifecyclestage: 'lead' }))
  it('deal name follows the handoff email format; priority gets a star', () => {
    expect(dealName(lead)).toBe('Priya Kulkarni · Kothrud · 3BHK full redesign')
    expect(dealName({ ...lead, priority: true })).toBe('⭐ Priya Kulkarni · Kothrud · 3BHK full redesign')
    expect(dealName({ ...lead, name: null, location: null, projectType: null })).toBe('Unknown · Location TBC · Project TBC')
  })
  it('deal stage follows lead status; amount only when a value is known', () => {
    expect(dealProperties(lead, DEFAULT_MAPPING)).toMatchObject({ pipeline: 'default', dealstage: 'presentationscheduled', amount: '850000' })
    expect(dealProperties({ ...lead, status: 'won' }, DEFAULT_MAPPING).dealstage).toBe('closedwon')
    expect(dealProperties({ ...lead, status: 'lost' }, DEFAULT_MAPPING).dealstage).toBe('closedlost')
    expect('amount' in dealProperties({ ...lead, projectValueInr: null }, DEFAULT_MAPPING)).toBe(false)
    expect('amount' in dealProperties({ ...lead, projectValueInr: 0 }, DEFAULT_MAPPING)).toBe(false)
  })
  it('config overrides are merged over defaults and junk is ignored', () => {
    const m = parseMapping({ pipeline: '12345', stages: { won: 'abc', lost: 42, bogus: 'x' } })
    expect(m.pipeline).toBe('12345'); expect(m.stages.won).toBe('abc'); expect(m.stages.lost).toBe('closedlost'); expect(parseMapping(null)).toEqual(DEFAULT_MAPPING)
  })
  it('note carries the summary + rubric + dashboard link, escapes HTML, and never contains a transcript', () => {
    const n = noteBody({ ...lead, summary: '<script>x</script> short summary' })
    expect(n).toContain('✅'); expect(n).toContain('⚠️'); expect(n).toContain('Spouse not on call'); expect(n).toContain('https://app.test/dashboard/leads/L1')
    expect(n).not.toContain('<script>'); expect(n).not.toMatch(/AGENT:|USER:|transcript/i)
  })
})

const fakeApi = () => {
  const calls: string[] = []
  return {
    calls,
    findContactByPhone: vi.fn(async (): Promise<{ id: string; properties: Record<string, string | null> } | null> => { calls.push('find'); return null }),
    createContact: vi.fn(async () => { calls.push('createContact'); return { id: 'C1', properties: {} } }),
    updateContact: vi.fn(async (id: string) => { calls.push(`updateContact:${id}`); return { id, properties: {} } }),
    createDeal: vi.fn(async () => { calls.push('createDeal'); return { id: 'D1', properties: {} } }),
    updateDeal: vi.fn(async (id: string) => { calls.push(`updateDeal:${id}`); return { id, properties: {} } }),
    createNote: vi.fn(async () => { calls.push('createNote'); return { id: 'N1', properties: {} } }),
  }
}

describe('syncLeadToApi', () => {
  it('first sync: finds no contact, creates contact + deal + one note', async () => {
    const api = fakeApi()
    const r = await syncLeadToApi(api, lead, { contactId: null, dealId: null }, DEFAULT_MAPPING)
    expect(r).toEqual({ contactId: 'C1', dealId: 'D1', createdDeal: true })
    expect(api.calls).toEqual(['find', 'createContact', 'createDeal', 'createNote'])
  })
  it('reuses an existing HubSpot contact found by phone (no duplicate contact)', async () => {
    const api = fakeApi(); api.findContactByPhone.mockResolvedValueOnce({ id: 'C9', properties: {} })
    const r = await syncLeadToApi(api, lead, { contactId: null, dealId: null }, DEFAULT_MAPPING)
    expect(r.contactId).toBe('C9'); expect(api.createContact).not.toHaveBeenCalled(); expect(api.updateContact).toHaveBeenCalledWith('C9', expect.any(Object))
  })
  it('is idempotent: a second sync updates the deal and creates nothing', async () => {
    const api = fakeApi()
    const r = await syncLeadToApi(api, { ...lead, status: 'won' }, { contactId: 'C1', dealId: 'D1' }, DEFAULT_MAPPING)
    expect(r.createdDeal).toBe(false)
    expect(api.createContact).not.toHaveBeenCalled(); expect(api.createDeal).not.toHaveBeenCalled(); expect(api.createNote).not.toHaveBeenCalled()
    expect(api.updateDeal).toHaveBeenCalledWith('D1', expect.objectContaining({ dealstage: 'closedwon' }))
  })
  it('adopts the existing contact when HubSpot answers 409 "Existing ID"', async () => {
    const api = fakeApi()
    api.createContact.mockRejectedValueOnce(new HubspotError('HubSpot POST failed: 409 Contact already exists. Existing ID: 777', 409, { message: 'Contact already exists. Existing ID: 777' }))
    const r = await syncLeadToApi(api, lead, { contactId: null, dealId: null }, DEFAULT_MAPPING)
    expect(r.contactId).toBe('777'); expect(api.updateContact).toHaveBeenCalledWith('777', expect.any(Object))
  })
  it('rethrows other contact errors', async () => {
    const api = fakeApi(); api.createContact.mockRejectedValueOnce(new HubspotError('nope', 403))
    await expect(syncLeadToApi(api, lead, { contactId: null, dealId: null }, DEFAULT_MAPPING)).rejects.toThrow('nope')
  })
  it('a failing note does not lose the deal', async () => {
    const api = fakeApi(); api.createNote.mockRejectedValueOnce(new Error('note failed'))
    expect((await syncLeadToApi(api, lead, { contactId: null, dealId: null }, DEFAULT_MAPPING)).dealId).toBe('D1')
  })
})

describe('isHubspotDue (decided from what we pushed, so it cannot loop)', () => {
  const synced = { status: 'accepted', project_value_inr: 100, hubspot_status: 'accepted', hubspot_value_inr: 100, hubspot_synced_at: '2026-10-10T00:00:00Z', hubspot_error: null }
  it('not due when status and value match what was pushed', () => expect(isHubspotDue(synced)).toBe(false))
  it('due when never synced, errored, status changed, or value changed', () => {
    expect(isHubspotDue({ ...synced, hubspot_synced_at: null })).toBe(true)
    expect(isHubspotDue({ ...synced, hubspot_error: 'boom' })).toBe(true)
    expect(isHubspotDue({ ...synced, status: 'won' })).toBe(true)
    expect(isHubspotDue({ ...synced, project_value_inr: 200 })).toBe(true)
  })
  it('null value equals "no value pushed"', () => expect(isHubspotDue({ ...synced, project_value_inr: null, hubspot_value_inr: null })).toBe(false))
})

describe('HubspotApi (HTTP)', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  it('sends the bearer token, associates the deal with the contact (type 3), the note with deal (214) and contact (202)', async () => {
    const f = vi.fn(async () => ok({ id: '1', properties: {} }))
    const api = new HubspotApi('tok_secret', f as unknown as typeof fetch, async () => undefined)
    await api.createDeal({ dealname: 'x' }, 'C1'); await api.createNote('b', 'D1', 'C1')
    const [[u1, i1], [, i2]] = f.mock.calls as unknown as [string, RequestInit][]
    expect(u1).toBe('https://api.hubapi.com/crm/v3/objects/deals')
    expect((i1.headers as Record<string, string>).Authorization).toBe('Bearer tok_secret')
    expect(JSON.parse(i1.body as string).associations[0].types[0].associationTypeId).toBe(3)
    expect(JSON.parse(i2.body as string).associations.map((a: { types: { associationTypeId: number }[] }) => a.types[0].associationTypeId)).toEqual([214, 202])
  })
  it('retries 429 then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok({ message: 'rate' }, 429)).mockResolvedValueOnce(ok({ results: [] }))
    expect(await new HubspotApi('t', f as unknown as typeof fetch, async () => undefined).findContactByPhone('+91')).toBeNull(); expect(f).toHaveBeenCalledTimes(2)
  })
  it('does not retry a 4xx and never leaks the token in the error', async () => {
    const f = vi.fn(async () => ok({ message: 'Invalid scope' }, 403))
    const err = await new HubspotApi('tok_secret', f as unknown as typeof fetch, async () => undefined).createContact({}).catch((e) => e)
    expect(err).toBeInstanceOf(HubspotError); expect(err.status).toBe(403); expect(err.message).not.toContain('tok_secret'); expect(f).toHaveBeenCalledTimes(1)
  })
  it('gives up after repeated 5xx', async () => {
    const f = vi.fn(async () => ok({ message: 'down' }, 503))
    await expect(new HubspotApi('t', f as unknown as typeof fetch, async () => undefined).updateDeal('1', {})).rejects.toThrow(/503/); expect(f).toHaveBeenCalledTimes(4)
  })
})
