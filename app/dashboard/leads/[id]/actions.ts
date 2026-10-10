'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'

const Update = z.object({
  id: z.uuid(),
  status: z.enum(['new', 'handed_off', 'accepted', 'consult_booked', 'won', 'lost']),
  value: z.string().trim().optional().transform((v) => (v ? Number(v.replace(/[,\s₹]/g, '')) : null)).pipe(z.number().min(0).max(1_000_000_000).nullable()),
})

/** Admin-only (RLS: admin_update on leads). Used to mark a lead won/lost and to enter its project value. */
export async function updateLead(form: FormData) {
  const { db } = await requireAdmin()
  const p = Update.safeParse({ id: form.get('id'), status: form.get('status'), value: form.get('value') ?? '' })
  if (!p.success) redirect(`/dashboard/leads/${String(form.get('id'))}?error=invalid`)
  const { error } = await db.from('leads').update({ status: p.data.status, project_value_inr: p.data.value }).eq('id', p.data.id)
  redirect(`/dashboard/leads/${p.data.id}${error ? '?error=save' : '?saved=1'}`)
}
