import { describe, expect, it } from 'vitest'
import { inr, inr2, inrCompact, minutes, seconds, pct } from '@/lib/dashboard/format'
import { resolveRange, startOfIstMonth } from '@/lib/dashboard/range'

describe('currency / duration formatting', () => {
  it('uses Indian digit grouping', () => { expect(inr(1234567)).toBe('₹12,34,567'); expect(inr(950000)).toBe('₹9,50,000'); expect(inr(0)).toBe('₹0') })
  it('compacts to lakh / crore for headlines, exact below a lakh', () => {
    expect(inrCompact(950000)).toBe('₹9.5 lakh'); expect(inrCompact(12_500_000)).toBe('₹1.25 crore'); expect(inrCompact(100000)).toBe('₹1 lakh')
    expect(inrCompact(85000)).toBe('₹85,000'); expect(inrCompact(0)).toBe('₹0')
  })
  it('shows an em dash for missing values, never NaN or 0', () => {
    for (const f of [inr, inr2, inrCompact, pct, seconds, minutes]) { expect(f(null)).toBe('—'); expect(f(undefined)).toBe('—') }
  })
  it('durations', () => { expect(seconds(3)).toBe('3s'); expect(seconds(125)).toBe('2m 5s'); expect(minutes(30)).toBe('30 min'); expect(minutes(150)).toBe('2h 30m'); expect(minutes(120)).toBe('2h') })
  it('unit costs keep paise', () => expect(inr2(1.333)).toBe('₹1.33'))
})

describe('date ranges (IST)', () => {
  // 2026-10-10 23:30 UTC is already 11 Oct 05:00 IST
  const now = new Date('2026-10-10T23:30:00Z')
  it('"today" is the IST day, not the UTC day', () => {
    const r = resolveRange({ range: 'today' }, now)
    expect(r.from.toISOString()).toBe('2026-10-10T18:30:00.000Z'); expect(r.to.toISOString()).toBe('2026-10-11T18:30:00.000Z')
  })
  it('month starts at midnight IST on the 1st', () => {
    expect(startOfIstMonth(now).toISOString()).toBe('2026-09-30T18:30:00.000Z')
    expect(resolveRange({}, now).key).toBe('month')
  })
  it('7d spans 7 IST days including today', () => {
    const r = resolveRange({ range: '7d' }, now)
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(7)
  })
  it('custom is inclusive of the end day; bad or reversed input falls back to the month', () => {
    const r = resolveRange({ range: 'custom', from: '2026-10-01', to: '2026-10-03' }, now)
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z'); expect(r.to.toISOString()).toBe('2026-10-03T18:30:00.000Z')
    expect(resolveRange({ range: 'custom', from: '2026-10-05', to: '2026-10-01' }, now).key).toBe('month')
    expect(resolveRange({ range: 'custom', from: "x'; drop", to: '2026-10-01' }, now).key).toBe('month')
    expect(resolveRange({ range: 'bogus' }, now).key).toBe('month')
  })
})
