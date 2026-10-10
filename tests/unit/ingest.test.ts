import { describe, expect, it } from 'vitest'
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

