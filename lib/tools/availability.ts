import { formatIST } from '@/lib/hours'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'

export type SlotQuery = { visitType?: 'site' | 'studio'; priority?: boolean; daysAhead?: number; limit?: number; prefer?: 'evening' | 'weekend' | 'any' }
export type SlotOffer = { slot_id: string; start: string; label: string; visit_type: 'site' | 'studio'; designer_first_name: string }

const MIN_LEAD_HOURS = 12

function istParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3_600_000) // IST = UTC+5:30, no DST
  return { hour: d.getUTCHours(), dow: d.getUTCDay(), day: d.toISOString().slice(0, 10) }
}

/** Open slots, spread across different days so the agent can offer real choice. Priority leads see the principal's slots only. */
export async function findSlots(db: Db, q: SlotQuery, now = new Date()): Promise<SlotOffer[]> {
  const from = new Date(now.getTime() + MIN_LEAD_HOURS * 3_600_000).toISOString()
  const to = new Date(now.getTime() + (q.daysAhead ?? 14) * 86_400_000).toISOString()
  let query = db
    .from('availability_slots')
    .select('id,slot_start,visit_type, designers!inner(name,is_principal,active)')
    .eq('is_booked', false).eq('designers.active', true)
    .gte('slot_start', from).lte('slot_start', to).order('slot_start').limit(400)
  if (q.visitType) query = query.eq('visit_type', q.visitType)
  if (q.priority) query = query.eq('designers.is_principal', true)
  const rows = must<{ id: string; slot_start: string; visit_type: 'site' | 'studio'; designers: { name: string } }[]>(await query, 'find slots')

  let filtered = rows
  if (q.prefer === 'evening') filtered = rows.filter((r) => istParts(r.slot_start).hour >= 17)
  else if (q.prefer === 'weekend') filtered = rows.filter((r) => [0, 6].includes(istParts(r.slot_start).dow))
  if (!filtered.length) filtered = rows // preference is a nicety, never an empty answer

  const limit = q.limit ?? 4
  const out: SlotOffer[] = []
  const seenStarts = new Set<string>()
  const perDay = new Map<string, number>()
  for (const r of filtered) {
    const key = `${r.slot_start}|${r.visit_type}`
    const day = istParts(r.slot_start).day
    if (seenStarts.has(key) || (perDay.get(day) ?? 0) >= 2) continue
    seenStarts.add(key)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    out.push({ slot_id: r.id, start: r.slot_start, label: formatIST(r.slot_start), visit_type: r.visit_type, designer_first_name: r.designers.name.split(' ')[0] })
    if (out.length >= limit) break
  }
  return out
}
