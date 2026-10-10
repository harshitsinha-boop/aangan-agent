import type { ReactNode } from 'react'
import Link from 'next/link'
import { OUTCOME_LABELS } from '@/lib/dashboard/format'

/** Single stat: the right form for one number (not a chart). */
export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'bad' | 'good' }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-[var(--bad)]' : tone === 'good' ? 'text-[var(--good)]' : ''}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function Section({ title, note, children, id }: { title: string; note?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

// Fixed entity -> colour map: an outcome keeps its colour whatever the filters (colour follows the entity, never its rank).
const OUTCOME_VAR: Record<string, string> = {
  qualified: 'var(--viz-1)', qualified_with_note: 'var(--viz-3)', declined: 'var(--viz-2)', escalated: 'var(--viz-4)', abandoned: 'var(--viz-5)',
}
export const outcomeColor = (o: string) => OUTCOME_VAR[o] ?? 'var(--muted-foreground)'

/** Part-to-whole: one horizontal stacked bar, 2px surface gaps, direct labels, plus a table view for accessibility. */
export function OutcomeSplit({ outcomes }: { outcomes: Record<string, number> }) {
  const order = ['qualified', 'qualified_with_note', 'declined', 'escalated', 'abandoned', 'unknown']
  const rows = order.filter((k) => outcomes[k]).map((k) => ({ k, n: outcomes[k] }))
  const total = rows.reduce((a, r) => a + r.n, 0)
  if (!total) return <p className="text-sm text-muted-foreground">No calls in this range.</p>
  return (
    <div>
      <div role="img" aria-label={`Outcomes of ${total} calls: ${rows.map((r) => `${OUTCOME_LABELS[r.k]} ${r.n}`).join(', ')}`}
        className="flex h-6 w-full gap-[2px] overflow-hidden rounded-md">
        {rows.map((r) => (
          <div key={r.k} title={`${OUTCOME_LABELS[r.k]}: ${r.n} (${Math.round((100 * r.n) / total)}%)`}
            style={{ flex: r.n, background: outcomeColor(r.k), minWidth: 6 }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.k} className="flex items-center gap-2">
            <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: outcomeColor(r.k) }} />
            <span>{OUTCOME_LABELS[r.k]}</span>
            <span className="tabular-nums text-muted-foreground">{r.n} · {Math.round((100 * r.n) / total)}%</span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">View as table</summary>
        <table className="mt-2 w-full max-w-sm text-sm"><tbody>
          {rows.map((r) => <tr key={r.k} className="border-b"><td className="py-1">{OUTCOME_LABELS[r.k]}</td><td className="py-1 text-right tabular-nums">{r.n}</td></tr>)}
        </tbody></table>
      </details>
    </div>
  )
}

/** Magnitude comparison across a few named categories: plain horizontal bars, one hue, value labels. */
export function Bars({ rows, empty }: { rows: { label: string; n: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_2.5rem]">
          <span className="truncate">{r.label}</span>
          <span className="h-3 rounded-sm bg-muted" role="presentation"><span className="block h-3 rounded-sm" style={{ width: `${(100 * r.n) / max}%`, background: 'var(--viz-1)' }} /></span>
          <span className="text-right tabular-nums">{r.n}</span>
        </li>
      ))}
    </ul>
  )
}

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const o = outcome ?? 'unknown'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs">
      <span aria-hidden className="size-2 rounded-full" style={{ background: outcomeColor(o) }} />{OUTCOME_LABELS[o] ?? o}
    </span>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-sm text-muted-foreground underline-offset-4 hover:underline">← {children}</Link>
}

export const istTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '—'
