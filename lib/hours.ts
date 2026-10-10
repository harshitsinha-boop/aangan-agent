import type { BusinessHours } from '@/lib/config'

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function parts(d: Date, tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    fmtCache.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { minutes: Number(p.hour) * 60 + Number(p.minute) }
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** True when `d` falls inside [start, end) in the business-hours timezone. Every day counts as a business day (TODO(Nikhil): weekends?). */
export function isBusinessHours(d: Date, bh: BusinessHours): boolean {
  const { minutes } = parts(d, bh.tz)
  return minutes >= toMin(bh.start) && minutes < toMin(bh.end)
}

/** Minutes between two instants that fall inside business hours (SLA clocks only run while the studio is open). */
export function businessMinutesBetween(from: Date, to: Date, bh: BusinessHours, capDays = 14): number {
  if (to <= from) return 0
  const end = Math.min(to.getTime(), from.getTime() + capDays * 86_400_000)
  let n = 0
  for (let t = from.getTime(); t < end; t += 60_000) if (isBusinessHours(new Date(t), bh)) n++
  return n
}

export const formatIST = (d: Date | string, opts: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, ...opts,
  }).format(typeof d === 'string' ? new Date(d) : d)
