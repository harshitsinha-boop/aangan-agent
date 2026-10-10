import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { BackLink, istTime, Section } from '@/components/dashboard/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { requireAdmin } from '@/lib/auth'
import { inr } from '@/lib/dashboard/format'
import { must } from '@/lib/supabase/admin'
import { updateLead } from './actions'

type P = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }
export default function Page(p: P) {
  return <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}><LeadDetail {...p} /></Suspense>
}

const CRITERIA: Record<string, string> = { real_project: 'Real project with execution', service_area: 'In service area', timeline: 'Realistic timeline', budget: 'Budget broadly aligned', decision_maker: 'Decision-maker' }

async function LeadDetail({ params, searchParams }: P) {
  const { id } = await params
  const sp = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { db } = await requireAdmin()
  const lead = must(await db.from('leads').select('*, callers(name,phone,email), calls(id,summary,after_hours,started_at,created_at), consultations(slot_start,visit_type,status,designers(name)), handoffs(sent_at,delivered_at,opened_at,accepted_at,reminder_sent_at,reassigned_at,designers(name))').eq('id', id).maybeSingle(), 'lead')
  if (!lead) notFound()
  const verdict = (lead.rubric_verdict ?? {}) as Record<string, { status: string; note?: string }>
  const handoffs = [...(lead.handoffs ?? [])].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))
  return (
    <div className="space-y-6">
      <BackLink href="/dashboard">Overview</BackLink>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{lead.priority && '⭐ '}{lead.callers?.name ?? 'Unknown'}</h1>
        <span className="rounded-full border px-2 py-0.5 text-xs capitalize">{String(lead.status).replace('_', ' ')}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card p-4 text-sm md:grid-cols-4">
        {[['Phone', lead.callers?.phone ?? 'not captured'], ['Email', lead.callers?.email ?? '—'], ['Location', lead.location ?? '—'], ['Project', lead.project_type ?? '—'],
          ['Carpet area', lead.carpet_area_sqft ? `${lead.carpet_area_sqft} sq ft` : '—'], ['Current state', lead.current_state ?? '—'], ['Timeline', lead.timeline ?? '—'],
          ['Budget (volunteered)', lead.budget_volunteered ?? '—'], ['Source / referrer', lead.source_or_referrer ?? '—'], ['Project value', inr(lead.project_value_inr)]].map(([k, v]) => (
          <div key={k}><dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="mt-0.5">{v}</dd></div>
        ))}
      </dl>
      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Rubric">
          <ul className="space-y-1.5 text-sm">
            {Object.entries(CRITERIA).map(([k, label]) => {
              const v = verdict[k]
              return <li key={k}>{v?.status === 'pass' ? '✅' : '⚠️'} {label}{v?.note && <span className="text-muted-foreground"> — {v.note}</span>}</li>
            })}
          </ul>
          {lead.uncertainty_notes && <p className="rounded-lg bg-muted p-3 text-sm"><b>Uncertainty:</b> {lead.uncertainty_notes}</p>}
        </Section>
        <Section title="Handoff">
          {handoffs.length ? (
            <ol className="space-y-3 text-sm">
              {handoffs.map((h, i) => (
                <li key={i} className="rounded-lg border bg-card p-3">
                  <div className="font-medium">{h.designers?.name}{h.reassigned_at && <span className="ml-2 text-xs text-muted-foreground">(reassigned away)</span>}</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                    <span>Sent {istTime(h.sent_at)}</span><span>Delivered {istTime(h.delivered_at)}</span><span>Opened {istTime(h.opened_at)}</span>
                    <span>Accepted {istTime(h.accepted_at)}</span><span>Reminder {istTime(h.reminder_sent_at)}</span><span>Reassigned {istTime(h.reassigned_at)}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">Not handed off yet.</p>}
          {(lead.consultations ?? []).filter((c: { status: string }) => c.status === 'booked').map((c: { slot_start: string; visit_type: string; designers: { name: string } }) => (
            <p key={c.slot_start} className="text-sm">📅 {istTime(c.slot_start)} · {c.visit_type} visit · {c.designers?.name}</p>
          ))}
        </Section>
      </div>
      <Section title="Call summary"><p className="max-w-3xl leading-relaxed">{lead.calls?.summary ?? 'No summary yet.'}</p>
        {lead.calls?.id && <Link className="text-sm underline underline-offset-4" href={`/dashboard/calls/${lead.calls.id}`}>Open call and transcript →</Link>}
      </Section>
      <Section title="Outcome" note="Feeds conversion and pipeline figures">
        <form action={updateLead} className="flex max-w-xl flex-wrap items-end gap-3 rounded-xl border bg-card p-4 text-sm">
          <input type="hidden" name="id" value={lead.id} />
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wider text-muted-foreground">Status</span>
            <select name="status" defaultValue={lead.status} className="rounded-md border bg-background px-2 py-1.5">
              {['new', 'handed_off', 'accepted', 'consult_booked', 'won', 'lost'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select></label>
          <label className="space-y-1"><span className="block text-xs uppercase tracking-wider text-muted-foreground">Project value (₹)</span>
            <input name="value" inputMode="numeric" defaultValue={lead.project_value_inr ?? ''} placeholder="e.g. 850000" className="w-40 rounded-md border bg-background px-2 py-1.5" /></label>
          <button className="rounded-md bg-primary px-4 py-1.5 text-primary-foreground">Save</button>
          {sp.saved && <span role="status" className="text-[var(--good)]">Saved</span>}
          {sp.error && <span role="alert" className="text-[var(--bad)]">Could not save: check the values.</span>}
        </form>
      </Section>
    </div>
  )
}
