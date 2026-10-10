// Date ranges for the dashboard, resolved in Asia/Kolkata (the studio's timezone; IST has no DST).
export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'
export type Resolved = { key: RangeKey; from: Date; to: Date; label: string }

const IST_MS = 5.5 * 3_600_000
const startOfIstDay = (d: Date) => new Date(Math.floor((d.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
const ymd = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10)

export function startOfIstMonth(d: Date): Date {
  const ist = new Date(d.getTime() + IST_MS)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MS)
}

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

/** `to` is exclusive. Unknown or malformed input falls back to the current month. */
export function resolveRange(p: { range?: string; from?: string; to?: string }, now = new Date()): Resolved {
  const today = startOfIstDay(now)
  const tomorrow = addDays(today, 1)
  switch (p.range) {
    case 'today': return { key: 'today', from: today, to: tomorrow, label: 'Today' }
    case '7d': return { key: '7d', from: addDays(today, -6), to: tomorrow, label: 'Last 7 days' }
    case '30d': return { key: '30d', from: addDays(today, -29), to: tomorrow, label: 'Last 30 days' }
    case 'custom':
      if (isDate(p.from) && isDate(p.to) && p.from! <= p.to!) {
        const from = new Date(`${p.from}T00:00:00+05:30`)
        return { key: 'custom', from, to: addDays(new Date(`${p.to}T00:00:00+05:30`), 1), label: `${p.from} to ${p.to}` }
      }
  }
  return { key: 'month', from: startOfIstMonth(now), to: tomorrow, label: 'This month' }
}

export const toInputDate = ymd
