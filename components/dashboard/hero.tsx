import Link from 'next/link'
import { ForceFieldBackground } from '@/components/brand/force-field-lazy'
import { inrCompact } from '@/lib/dashboard/format'
import { toInputDate, type Resolved } from '@/lib/dashboard/range'
import type { Metrics } from '@/lib/dashboard/queries'

const PRESETS: [string, string][] = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month']]

export const withParams = (raw: Record<string, string | undefined>, over: Record<string, string | undefined>) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...raw, ...over })) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : '?'
}

/** The ONE branded data-adjacent surface: a 220px band with the headline overlaid. Overlay is pointer-events-none
 *  except the date-range picker. KPI cards, charts and tables below sit on a plain background. */
export function Hero({ headline, range, raw }: { headline: Metrics; range: Resolved; raw: Record<string, string | undefined> }) {
  const ah = headline.after_hours_booked
  const missing: number = ah.missing_value
  return (
    <section aria-label="This month at a glance" className="relative h-[220px] overflow-hidden rounded-2xl border bg-[#140d08] text-white">
      <ForceFieldBackground />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#f1dcc4]/70">This month</p>
          <p className="mt-2 max-w-3xl text-xl font-semibold leading-snug sm:text-3xl">
            <span className="text-[#f6c590]">{inrCompact(ah.value_inr)}</span> pipeline from after-hours calls
            <span className="mx-2 text-white/40">·</span>
            <span className="text-[#f1dcc4]">{inrCompact(headline.cost.total_inr)}</span> system cost
          </p>
          <p className="mt-1.5 text-xs text-white/60">
            {ah.leads} after-hours {ah.leads === 1 ? 'booking' : 'bookings'}
            {missing > 0 && ` · ${missing} awaiting a project value`}
            {!headline.cost.rates_configured && ' · cost rates not set yet'}
          </p>
        </div>
        <RangePicker range={range} raw={raw} />
      </div>
    </section>
  )
}

function RangePicker({ range, raw }: { range: Resolved; raw: Record<string, string | undefined> }) {
  const base = { ...raw, range: undefined, from: undefined, to: undefined }
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-sm">
      <nav aria-label="Date range" className="flex overflow-hidden rounded-lg border border-white/20 bg-black/30 backdrop-blur-sm">
        {PRESETS.map(([k, label]) => (
          <Link key={k} href={withParams(base, { range: k })} aria-current={range.key === k ? 'true' : undefined}
            className={`px-3 py-1.5 transition ${range.key === k ? 'bg-white/20 font-medium' : 'text-white/75 hover:bg-white/10'}`}>{label}</Link>
        ))}
      </nav>
      <form method="get" className="flex items-center gap-1.5">
        {Object.entries(base).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="range" value="custom" />
        <label className="sr-only" htmlFor="from">From</label>
        <input id="from" name="from" type="date" required defaultValue={range.key === 'custom' ? raw.from : toInputDate(range.from)}
          className="rounded-lg border border-white/20 bg-black/30 px-2 py-1.5 text-xs [color-scheme:dark]" />
        <span className="text-white/50">to</span>
        <label className="sr-only" htmlFor="to">To</label>
        <input id="to" name="to" type="date" required defaultValue={range.key === 'custom' ? raw.to : toInputDate(new Date(range.to.getTime() - 1))}
          className="rounded-lg border border-white/20 bg-black/30 px-2 py-1.5 text-xs [color-scheme:dark]" />
        <button className="rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-xs hover:bg-white/10">Apply</button>
      </form>
      <span className="text-xs text-white/60">{range.label}</span>
    </div>
  )
}
