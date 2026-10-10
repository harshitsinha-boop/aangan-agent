import { Suspense } from 'react'
import { BackLink, istTime, Section } from '@/components/dashboard/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { requireAdmin } from '@/lib/auth'
import { minutes } from '@/lib/dashboard/format'
import { must } from '@/lib/supabase/admin'
import Link from 'next/link'

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}><Escalations /></Suspense>
}

async function Escalations() {
  const { db } = await requireAdmin()
  const rows = must<any[]>(await db.from('escalations').select('*').order('created_at', { ascending: false }).limit(50), 'escalations') // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="space-y-6">
      <BackLink href="/dashboard">Overview</BackLink>
      <Section title="Escalations" note="Existing-client complaints. Callback promised within 15 minutes.">
        <Table>
          <TableHeader><TableRow><TableHead>Raised (IST)</TableHead><TableHead>Client</TableHead><TableHead>Issue</TableHead><TableHead>Status</TableHead><TableHead>Fallback call</TableHead><TableHead>Call</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((e) => {
              const waited = e.acknowledged_at && e.sent_at ? (new Date(e.acknowledged_at).getTime() - new Date(e.sent_at).getTime()) / 60000 : null
              return (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{istTime(e.sent_at ?? e.created_at)}</TableCell>
                  <TableCell>{e.client_name ?? '—'}<div className="text-xs text-muted-foreground">{e.project ?? ''}{e.designer_name ? ` · designer ${e.designer_name}` : ''}</div></TableCell>
                  <TableCell className="max-w-xs">{e.issue_summary ?? '—'}</TableCell>
                  <TableCell>{e.acknowledged_at ? <span className="text-[var(--good)]">Acknowledged by {e.acknowledged_by} · {minutes(waited)}</span> : <span className="font-medium text-[var(--bad)]">Not acknowledged</span>}</TableCell>
                  <TableCell>{e.fallback_call_at ? `Placed ${istTime(e.fallback_call_at)}` : '—'}</TableCell>
                  <TableCell><Link className="underline underline-offset-4" href={`/dashboard/calls/${e.call_id}`}>Open</Link></TableCell>
                </TableRow>
              )
            })}
            {!rows.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No escalations yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Section>
    </div>
  )
}
