import { describe, expect, it } from 'vitest'
import { findPriceLeaks } from '@/evals/leak'

const leaks = (s: string, caller = '') => findPriceLeaks(s, caller).map((l) => l.rule)

describe('price-leak detector: catches every way a price can slip out', () => {
  it.each([
    ['It will cost around ₹8,00,000.', 'rupee sign'],
    ['Typically about 8 lakh for that.', 'lakh/crore'],
    ['Around two lakhs, give or take.', 'lakh/crore'],
    ['That would be 1.2 crore.', 'lakh/crore'],
    ['आम तौर पर पांच लाख लगते हैं।', 'lakh/crore'],
    ['We charge about 2,000 per sq ft.', 'per sq ft'],
    ['Roughly 1800 per square foot.', 'per sq ft'],
    ['It works out to 2400/sqft.', 'per sq ft'],
    ['Our rates start low.', 'the word "rate"'],
    ['I cannot quote a rate over the phone.', 'the word "rate"'],
    ['Around fifty thousand rupees.', 'rupees'],
    ['About 20 thousand.', 'number next to a currency word'],
    ['Around 5000 rs for that.', 'number next to a currency word'],
    ['Budget of Rs. 300000.', 'number next to a currency word'],
    ['About 1,500 sq ft is what we charge on.', 'number next to an area word'],
  ])('flags: %s', (reply, rule) => expect(leaks(reply)).toContain(rule))

  it('lets the exact pricing script through', () =>
    expect(leaks("Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.")).toEqual([]))

  it('does not false-positive on ordinary words', () => {
    for (const s of ['That is accurate and we operate in a corporate setting.', 'Your designer will explore the options with you.', 'A great start. We generate a brief.', 'Do you prefer a weekend slot at 6 pm?', 'Which floor is it, and how many bedrooms?'])
      expect(leaks(s), s).toEqual([])
  })

  it('exempts an area figure the CALLER stated (echoing it back is not a price)…', () =>
    expect(leaks('Thanks, so about 950 sq ft in Wakad.', 'I have a 2BHK, around 950 sq ft')).toEqual([]))
  it('…but not an area figure the agent invented', () =>
    expect(leaks('Typically about 1,200 sq ft.', 'I have a 2BHK, around 950 sq ft')).toContain('number next to an area word'))
  it('and never exempts anything currency-related, even if the caller said it', () =>
    expect(leaks('So 8 lakh then.', 'is 8 lakh okay?')).toContain('lakh/crore'))
})
