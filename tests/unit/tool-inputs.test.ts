import { describe, expect, it } from 'vitest'
import { parseJson } from '@/lib/http'
import { AvailabilityBody, BookBody, EscalateBody } from '@/lib/tools/schemas'

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) })
const ok = async (schema: Parameters<typeof parseJson>[1], body: unknown) => {
  const r = await parseJson(req(body), schema)
  return 'data' in r ? { ok: true as const, data: r.data as Record<string, unknown> } : { ok: false as const, status: r.response.status }
}
const SLOT = '123e4567-e89b-42d3-a456-426614174000'

describe('tool inputs tolerate how voice LLMs actually send arguments', () => {
  it('empty strings and nulls mean "not provided" (caller declined to give an email)', async () => {
    const r = await ok(BookBody, { phone: '9876543210', slot_id: SLOT, email: '', budget_volunteered: '', location: null, vaani_call_id: '' })
    expect(r.ok).toBe(true)
    if (r.ok) { expect('email' in r.data).toBe(false); expect('vaani_call_id' in r.data).toBe(false) }
  })
  it('numbers and booleans sent as text are accepted', async () => {
    const r = await ok(BookBody, { phone: '9876543210', slot_id: SLOT, carpet_area_sqft: '1400', priority: 'false' })
    expect(r).toMatchObject({ ok: true, data: { carpet_area_sqft: 1400, priority: false } })
    const a = await ok(AvailabilityBody, { limit: '3', days_ahead: '14', priority: 'true', visit_type: 'site' })
    expect(a).toMatchObject({ ok: true, data: { limit: 3, days_ahead: 14, priority: true } })
  })
  it('phone stays text (never turned into a number) and a call id is optional', async () => {
    const r = await ok(EscalateBody, { phone: '9876543210', name: 'Sheetal' })
    expect(r).toMatchObject({ ok: true, data: { phone: '9876543210' } })
  })
  it('still rejects real garbage', async () => {
    expect((await ok(BookBody, { phone: '9876543210', slot_id: 'not-a-uuid' })).ok).toBe(false)
    expect((await ok(BookBody, { phone: '9876543210', slot_id: SLOT, carpet_area_sqft: 'lots' })).ok).toBe(false)
    expect((await ok(AvailabilityBody, { limit: '99' })).ok).toBe(false)
    expect((await ok(AvailabilityBody, { visit_type: 'rooftop' })).ok).toBe(false)
    expect((await ok(EscalateBody, { phone: '9876543210' })).ok).toBe(false)
  })
})
