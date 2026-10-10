const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** ₹12,34,567 (Indian digit grouping). */
export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${inrFmt.format(Math.round(n))}`)

/** ₹9.5 lakh / ₹1.2 crore for headline figures; exact below one lakh. */
export function inrCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  const f = (v: number) => v.toFixed(2).replace(/\.?0+$/, '')
  if (abs >= 1e7) return `₹${f(n / 1e7)} crore`
  if (abs >= 1e5) return `₹${f(n / 1e5)} lakh`
  return inr(n)
}

/** Money with paise for small unit costs (cost per call). */
export const inr2 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${n.toFixed(2)}`)

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`)

export function seconds(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 60) return `${Math.round(n * 10) / 10}s`
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`
}

export function minutes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 60) return `${Math.round(n)} min`
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

export const OUTCOME_LABELS: Record<string, string> = {
  qualified: 'Qualified', qualified_with_note: 'Qualified, with note', declined: 'Declined', escalated: 'Escalated', abandoned: 'Abandoned', unknown: 'Unclassified',
}
export const OUTCOME_ORDER = ['qualified', 'qualified_with_note', 'declined', 'escalated', 'abandoned', 'unknown']

export const DECLINE_LABELS: Record<string, string> = {
  area: 'Outside Pune / PCMC', advice_only: 'Advice only', timeline: 'Timeline too short', budget: 'Budget below project range',
  too_small: 'Too small', too_large: 'Too large', out_of_scope: 'Out of scope', other: 'Other',
}
