import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { BackLink, istTime, OutcomeBadge, Section } from '@/components/dashboard/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { requireAdmin } from '@/lib/auth'
import { DECLINE_LABELS, inr2, seconds } from '@/lib/dashboard/format'
import { must } from '@/lib/supabase/admin'

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}><CallDetail params={params} /></Suspense>
}

/** Splits Vaani's "[hh:mm:ss] AGENT: …" / "AGENT: …" transcript into speaker turns. */
function turns(t: string) {
  return t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(?:\[[^\]]*\]\s*)?(AGENT|USER|CALLER)\s*:\s*([\s\S]*)$/i)
    return m ? { who: m[1].toUpperCase() === 'AGENT' ? 'Agent' : 'Caller', text: m[2] } : { who: '', text: s }
  })
}

async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { db } = await requireAdmin()
  const call = must(await db.from('calls').select('*, callers(name,phone,email,is_existing_client), leads(id), escalations(id,acknowledged_by,acknowledged_at,fallback_call_at), call_costs(component,units,inr)').eq('id', id).maybeSingle(), 'call')
  if (!call) notFound()
  const lead = Array.isArray(call.leads) ? call.leads[0] : call.leads
  const esc = Array.isArray(call.escalations) ? call.escalations[0] : call.escalations
  return (
    <div className="space-y-6">
      <BackLink href="/dashboard">Overview</BackLink>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{call.callers?.name ?? 'Unknown caller'}</h1>
        <OutcomeBadge outcome={call.outcome} />
        {call.after_hours && <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">after hours</span>}
        {call.callers?.is_existing_client && <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">existing client</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card p-4 text-sm md:grid-cols-4">
        {[['When (IST)', istTime(call.started_at ?? call.created_at)], ['Duration', seconds(call.duration_s)], ['Language', (call.language ?? '—').toUpperCase()],
          ['Phone', call.callers?.phone ?? 'not captured'], ['Email', call.callers?.email ?? '—'], ['Intent', call.intent ?? '—'],
          ['Decline reason', call.decline_reason ? (DECLINE_LABELS[call.decline_reason] ?? call.decline_reason) : '—'], ['Vaani call id', call.vaani_call_id]].map(([k, v]) => (
          <div key={k}><dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="mt-0.5 break-all">{v}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-4 text-sm">
        {lead && <Link className="underline underline-offset-4" href={`/dashboard/leads/${lead.id}`}>View lead →</Link>}
        {esc && <Link className="underline underline-offset-4" href="/dashboard/escalations">View escalation{esc.acknowledged_by ? ` (owner: ${esc.acknowledged_by})` : ' (not acknowledged)'} →</Link>}
      </div>
      <Section title="Summary"><p className="max-w-3xl leading-relaxed">{call.summary ?? 'No summary yet.'}</p></Section>
      <Section title="Transcript" note="Visible here only; never included in emails">
        {call.transcript ? (
          <ol className="space-y-3 rounded-xl border bg-card p-4 text-sm leading-relaxed">
            {turns(call.transcript).map((t, i) => (
              <li key={i} className="grid grid-cols-[4.5rem_1fr] gap-3"><span className={`text-xs font-semibold uppercase tracking-wider ${t.who === 'Agent' ? 'text-primary' : 'text-muted-foreground'}`}>{t.who}</span><span>{t.text}</span></li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">Transcript not available yet.</p>}
      </Section>
      {call.call_costs?.length > 0 && (
        <Section title="Cost of this call">
          <ul className="max-w-sm space-y-1 text-sm">{call.call_costs.map((c: { component: string; inr: number }) => <li key={c.component} className="flex justify-between"><span>{c.component.replace('_', ' ')}</span><span className="tabular-nums">{inr2(c.inr)}</span></li>)}</ul>
        </Section>
      )}
    </div>
  )
}
