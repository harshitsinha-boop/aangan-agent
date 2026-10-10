import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, parseConfig } from '@/lib/config'
import { businessMinutesBetween, isBusinessHours } from '@/lib/hours'
import { normalizePhone, phoneLast4 } from '@/lib/phone'

describe('normalizePhone', () => {
  it.each([
    ['98765 43210', '+919876543210'], ['09876543210', '+919876543210'], ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'], ['0091 9876543210', '+919876543210'], ['+14155551234', '+14155551234'],
  ])('%s -> %s', (i, o) => expect(normalizePhone(i)).toBe(o))
  it.each(['12345', 'abc', '', '+0123456789', '5876543210'])('rejects %s', (i) => expect(normalizePhone(i)).toBeNull())
  it('masks to last 4 digits', () => {
    expect(phoneLast4('+919876543210')).toBe('••••3210')
    expect(phoneLast4(null)).toBe('not captured')
  })
})

describe('business hours (10:00-19:00 IST)', () => {
  const bh = DEFAULT_CONFIG.businessHours
  const ist = (s: string) => new Date(`${s}+05:30`)
  it('classifies instants in IST regardless of server timezone', () => {
    expect(isBusinessHours(ist('2026-10-12T09:59:00'), bh)).toBe(false)
    expect(isBusinessHours(ist('2026-10-12T10:00:00'), bh)).toBe(true)
    expect(isBusinessHours(ist('2026-10-12T18:59:00'), bh)).toBe(true)
    expect(isBusinessHours(ist('2026-10-12T19:00:00'), bh)).toBe(false)
    expect(isBusinessHours(ist('2026-10-12T23:30:00'), bh)).toBe(false)
  })
  it('SLA clock only counts open hours', () => {
    expect(businessMinutesBetween(ist('2026-10-12T11:00:00'), ist('2026-10-12T13:00:00'), bh)).toBe(120)
    // sent 18:30, checked next morning 10:30 -> 30 min tonight + 30 min tomorrow
    expect(businessMinutesBetween(ist('2026-10-12T18:30:00'), ist('2026-10-13T10:30:00'), bh)).toBe(60)
    expect(businessMinutesBetween(ist('2026-10-12T20:00:00'), ist('2026-10-13T09:00:00'), bh)).toBe(0)
  })
})

describe('parseConfig', () => {
  it('reads values, falls back to defaults, ignores junk', () => {
    const c = parseConfig([{ key: 'min_completion_weeks', value: 10 }, { key: 'escalation_ack_minutes', value: 'abc' }, { key: 'answer_mode', value: 'bogus' }])
    expect(c.minCompletionWeeks).toBe(10)
    expect(c.escalationAckMinutes).toBe(5)
    expect(c.answerMode).toBe('all_calls')
  })
})
