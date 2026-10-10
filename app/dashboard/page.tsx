import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { FilterBar } from '@/components/dashboard/filters'
import { Hero } from '@/components/dashboard/hero'
import { Bars, istTime, OutcomeBadge, OutcomeSplit, Section, Stat } from '@/components/dashboard/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { requireAdmin } from '@/lib/auth'
import { DECLINE_LABELS, inr, inr2, inrCompact, minutes, pct, seconds } from '@/lib/dashboard/format'
import { getHeadline, getMetrics, parseFilters, recentBounces, recentCalls, recentLeads } from '@/lib/dashboard/queries'

type SP = Promise<Record<string, string | string[] | undefined>>

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<div className="space-y-6"><Skeleton className="h-[220px] rounded-2xl" /><Skeleton className="h-40 rounded-xl" /></div>}>
      <Overview searchParams={searchParams} />
    </Suspense>
  )
}

const COMPONENT_LABELS: Record<string, string> = {
  telephony_min: 'Telephony', stt_min: 'Speech-to-text', tts_min: 'Text-to-speech', llm_call: 'LLM', platform_min: 'Voice platform', email: 'Email',
}

async function Overview({ searchParams }: { searchParams: SP }) {
  await connection() // time-relative (this month / last 14 days): always render at request time
  const { db } = await requireAdmin()
  const f = parseFilters(await searchParams)
  const [m, headline, calls, leads, bounces] = await Promise.all([
    getMetrics(db, f), getHeadline(db), recentCalls(db, f), recentLeads(db, f), recentBounces(db),
  ])
  const esc = m.escalations, pick = m.designer_pickup, cost = m.cost
  const declineRows = Object.entries(m.decline_reasons as Record<string, number>).map(([k, n]) => ({ label: DECLINE_LABELS[k] ?? k, n })).sort((a, b) => b.n - a.n)
  const costRows = Object.entries(cost.by_component as Record<string, number>).sort((a, b) => b[1] - a[1])

  return (
    <>
      <Hero headline={headline} range={f.range} raw={f.raw} />

      {bounces.length > 0 && (
        <div role="alert" className="rounded-xl border border-[var(--bad)]/40 bg-[var(--bad)]/5 p-4 text-sm">
          <p className="font-medium text-[var(--bad)]">⚠ {bounces.length} email{bounces.length > 1 ? 's' : ''} bounced in the last 14 days</p>
          <p className="mt-1 text-muted-foreground">A bounced handoff means a designer may not have been told about a lead. Check the address in the Designers table.</p>
          <ul className="mt-2 space-y-0.5">
            {bounces.map((b) => (
              <li key={b.email_message_id + b.occurred_at} className="tabular-nums">
                {istTime(b.occurred_at)} · {Array.isArray(b.payload?.data?.to) ? b.payload.data.to.join(', ') : 'recipient unknown'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar raw={f.raw} afterHoursOnly={f.afterHoursOnly} outcome={f.outcome} />

      <Section title="What the system generated" note={f.range.label}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Calls answered" value={m.calls_answered} />
          <Stat label="Median time to answer" value={seconds(m.median_time_to_answer_s)} hint="ring to AI pickup" />
          <Stat label="After hours" value={pct(m.after_hours_pct)} hint={`${m.after_hours_calls} calls`} />
          <Stat label="Consultations booked" value={m.consultations_booked} />
          <Stat label="Designer pickup" value={minutes(pick.median_minutes)} hint={`median to accept · ${pick.waiting} waiting · ${pick.reassigned} reassigned`} />
          <Stat label="Escalations" value={esc.total} hint={`${minutes(esc.median_minutes_to_ack)} median to acknowledge${esc.unacknowledged ? ` · ${esc.unacknowledged} open` : ''}`} tone={esc.unacknowledged ? 'bad' : 'default'} />
          <Stat label="Fallback calls" value={esc.fallback_calls} hint="escalations nobody acknowledged in time" tone={esc.fallback_calls ? 'bad' : 'default'} />
          <Stat label="Email bounces" value={m.email_bounces.count} hint={m.email_bounces.complaints ? `${m.email_bounces.complaints} spam complaints` : undefined} tone={m.email_bounces.count ? 'bad' : 'default'} />
          <Stat label="Conversion to project" value={pct(m.conversion.pct)} hint={`${m.conversion.won} won of ${m.conversion.leads} leads`} />
          <Stat label="Pipeline value" value={inrCompact(m.pipeline.value_inr)} hint={m.pipeline.missing_value ? `${m.pipeline.missing_value} leads awaiting a value` : 'open + won leads'} />
          <Stat label="Won value" value={inrCompact(m.pipeline.won_value_inr)} />
        </div>
      </Section>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Outcomes"><OutcomeSplit outcomes={m.outcomes} /></Section>
        <Section title="Decline reasons"><Bars rows={declineRows} empty="No declined calls in this range." /></Section>
      </div>

      <Section title="Cost" note="Vaani exposes no per-call cost, so it is computed from the rates table × usage">
        {!cost.rates_configured && (
          <p className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-3 text-sm">
            Cost rates are all ₹0, so every figure below reads ₹0. Enter your Vaani and Resend rates in <code>cost_rates</code> to make this meaningful.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total cost" value={inr2(cost.total_inr)} />
          <Stat label="Per call" value={inr2(cost.per_call)} />
          <Stat label="Per qualified lead" value={inr2(cost.per_qualified_lead)} />
          <Stat label="Per booked consultation" value={inr2(cost.per_booked_consultation)} />
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Component</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
          <TableBody>{costRows.map(([k, v]) => <TableRow key={k}><TableCell>{COMPONENT_LABELS[k] ?? k}</TableCell><TableCell className="text-right tabular-nums">{inr2(v)}</TableCell></TableRow>)}</TableBody>
        </Table>
      </Section>

      <Section title="Recent calls" note={`${calls.length} shown`}>
        <Table>
          <TableHeader><TableRow><TableHead>When (IST)</TableHead><TableHead>Caller</TableHead><TableHead>Outcome</TableHead><TableHead>Lang</TableHead><TableHead className="text-right">Duration</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap tabular-nums">{istTime(c.started_at ?? c.created_at)}{c.after_hours && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">after hours</span>}</TableCell>
                <TableCell>{c.callers?.name ?? '—'}<div className="text-xs text-muted-foreground tabular-nums">{c.callers?.phone ?? 'number not captured'}</div></TableCell>
                <TableCell><OutcomeBadge outcome={c.outcome} />{c.decline_reason && <div className="mt-1 text-xs text-muted-foreground">{DECLINE_LABELS[c.decline_reason] ?? c.decline_reason}</div>}</TableCell>
                <TableCell className="uppercase">{c.language ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{seconds(c.duration_s)}</TableCell>
                <TableCell><Link className="underline underline-offset-4" href={`/dashboard/calls/${c.id}`}>Open</Link></TableCell>
              </TableRow>
            ))}
            {!calls.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No calls match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Section>

      <Section title="Recent leads" note={`${leads.length} shown`}>
        <Table>
          <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Project</TableHead><TableHead>Status</TableHead><TableHead>Consultation</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
          <TableBody>
            {leads.map((l) => {
              const k = (l.consultations ?? []).find((x: { status: string }) => x.status === 'booked')
              return (
                <TableRow key={l.id}>
                  <TableCell>{l.priority && <span title="Priority" aria-label="Priority">⭐ </span>}{l.callers?.name ?? 'Unknown'}<div className="text-xs text-muted-foreground">{l.location ?? '—'}</div></TableCell>
                  <TableCell>{l.project_type ?? '—'}{l.carpet_area_sqft ? <div className="text-xs text-muted-foreground">{l.carpet_area_sqft} sq ft</div> : null}</TableCell>
                  <TableCell className="capitalize">{String(l.status).replace('_', ' ')}</TableCell>
                  <TableCell className="whitespace-nowrap">{k ? `${istTime(k.slot_start)} · ${k.visit_type}` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.project_value_inr)}</TableCell>
                  <TableCell><Link className="underline underline-offset-4" href={`/dashboard/leads/${l.id}`}>Open</Link></TableCell>
                </TableRow>
              )
            })}
            {!leads.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No leads match these filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Section>
    </>
  )
}
