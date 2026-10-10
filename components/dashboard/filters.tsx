import Link from 'next/link'
import { OUTCOME_LABELS } from '@/lib/dashboard/format'
import { withParams } from './hero'

/** No client JS: a plain GET form, so filters live in the URL and survive reloads and sharing. */
export function FilterBar({ raw, afterHoursOnly, outcome }: { raw: Record<string, string | undefined>; afterHoursOnly: boolean; outcome: string | null }) {
  const keep = { range: raw.range, from: raw.from, to: raw.to }
  const active = afterHoursOnly || !!outcome
  return (
    <form method="get" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="ah" value="1" defaultChecked={afterHoursOnly} className="size-4 accent-[var(--primary)]" />
        After-hours calls only
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Outcome</span>
        <select name="outcome" defaultValue={outcome ?? ''} className="rounded-md border bg-background px-2 py-1">
          <option value="">All</option>
          {['qualified', 'qualified_with_note', 'declined', 'escalated', 'abandoned'].map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
        </select>
      </label>
      <button className="rounded-md bg-primary px-3 py-1 text-primary-foreground">Apply filters</button>
      {active && <Link href={withParams(keep, {})} className="text-muted-foreground underline underline-offset-4">Clear</Link>}
    </form>
  )
}
