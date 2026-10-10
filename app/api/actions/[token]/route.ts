import { after } from 'next/server'
import { confirmPage, REFUSALS, resultPage } from '@/lib/actions-page'
import { sendReassignedHandoff } from '@/lib/notify'
import { adminDb, must } from '@/lib/supabase/admin'
import { applyToken, peekToken } from '@/lib/tokens'

// Emailed action links. GET only DISPLAYS a confirmation page (mail scanners prefetch GET links, so a GET must
// never change data); the change is applied by the POST from that page. No login needed; the single-use,
// expiring, hashed token is the capability and it only touches the one record it was minted for.

const COPY = {
  accept: ['Accept this lead', 'Confirm you are taking this lead. The client expects a call or visit from you.', 'Accept lead'],
  reassign: ['Reassign this lead', 'This hands the lead to the principal designer. You will no longer be responsible for it.', 'Reassign to principal'],
  acknowledge: ['Acknowledge escalation', 'You will be recorded as the owner and are expected to call the client back.', 'I will call back'],
} as const

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const db = adminDb()
  const p = await peekToken(db, token)
  if (p.status !== 'valid') {
    const [t, m] = REFUSALS[p.status] ?? REFUSALS.invalid
    return resultPage(t, m, 410)
  }
  const [title, blurb, button] = COPY[p.action]
  let rows: [string, string | null | undefined][] = []
  if (p.targetTable === 'handoffs') {
    const h = must(await db.from('handoffs').select('leads(project_type,location,carpet_area_sqft,callers(name))').eq('id', p.targetId).maybeSingle(), 'ctx')
    const l = h?.leads
    rows = [['Client', l?.callers?.name], ['Project', l?.project_type], ['Location', l?.location], ['Carpet area', l?.carpet_area_sqft ? `${l.carpet_area_sqft} sq ft` : null]]
  } else {
    const e = must(await db.from('escalations').select('client_name,project,issue_summary,designer_name').eq('id', p.targetId).maybeSingle(), 'ctx')
    rows = [['Client', e?.client_name], ['Project', e?.project], ['Designer', e?.designer_name], ['Issue', e?.issue_summary]]
  }
  return confirmPage(title, blurb, { rows }, button)
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const db = adminDb()
  const r = await applyToken(db, token)
  if (!r.ok) {
    const [t, m] = REFUSALS[r.code] ?? REFUSALS.invalid
    return resultPage(t, r.code === 'already_acknowledged' && r.by ? `${m} (${String(r.by)})` : m, 409)
  }
  switch (r.code) {
    case 'accepted': return resultPage('Lead accepted', 'Thank you. The lead is now marked as accepted in the dashboard.')
    case 'reassigned':
      after(() => sendReassignedHandoff(db, String(r.new_handoff_id)).catch((e) => console.error('reassign email failed', e)))
      return resultPage('Lead reassigned', 'The principal designer has been notified.')
    case 'acknowledged': return resultPage('Escalation acknowledged', `You are recorded as the owner (${String(r.by)}). Please call the client back now.`)
    default: return resultPage('Done', 'Your action was recorded.')
  }
}
