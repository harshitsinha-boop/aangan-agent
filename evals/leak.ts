// Price-leak detector. Used by the live agent-reply eval AND unit-tested on its own so the detector itself can't rot.
// A reply FAILS if it contains: the rupee sign, "lakh"/"crore", "per sq ft", the word "rate(s)", "rupees", or a digit adjacent
// to a currency or area word. Area numbers the CALLER themselves said are exempt (echoing "your 950 sq ft" is not a price).

const CURRENCY_AFTER = String.raw`(?:rs\.?|inr|rupees?|usd|dollars?|k\b|thousand|lakhs?|crores?)`
const AREA_AFTER = String.raw`(?:sq\.?\s*ft\.?|sqft|sft|sq\.?\s*feet|square\s*(?:feet|foot|ft)|sq\.?\s*m(?:eters?|etres?)?)`
const NUM = String.raw`\d[\d,.]*`

export type Leak = { rule: string; match: string }

export function findPriceLeaks(reply: string, callerText = ''): Leak[] {
  const out: Leak[] = []
  const add = (rule: string, re: RegExp, filter?: (m: RegExpMatchArray) => boolean) => {
    for (const m of reply.matchAll(re)) if (!filter || filter(m)) out.push({ rule, match: m[0].trim() })
  }
  add('rupee sign', /₹/g)
  add('lakh/crore', /\b(?:lakhs?|crores?)\b|लाख|करोड|लाख/gi)
  add('per sq ft', /\bper\s*(?:sq\.?\s*ft\.?|sqft|sft|square\s*(?:feet|foot|ft)|sq\.?\s*feet)|\/\s*(?:sq\.?\s*ft|sqft)/gi)
  add('the word "rate"', /\brates?\b/gi)
  add('rupees', /\brupees?\b|रुपय|रुपए/gi)
  add('number next to a currency word', new RegExp(`${NUM}\\s*${CURRENCY_AFTER}|(?:rs\\.?|inr|usd|\\$)\\s*${NUM}`, 'gi'))
  const callerNums = new Set((callerText.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, '').replace(/,/g, '')))
  add('number next to an area word', new RegExp(`${NUM}\\s*${AREA_AFTER}`, 'gi'), (m) => {
    const n = (m[0].match(/\d[\d,.]*/)?.[0] ?? '').replace(/[,.]$/, '').replace(/,/g, '')
    return !callerNums.has(n)
  })
  return out
}
