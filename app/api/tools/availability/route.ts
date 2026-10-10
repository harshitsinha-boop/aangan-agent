import { env } from '@/lib/env'
import { json, parseJson, requireSecret } from '@/lib/http'
import { adminDb } from '@/lib/supabase/admin'
import { findSlots } from '@/lib/tools/availability'
import { AvailabilityBody } from '@/lib/tools/schemas'

export async function POST(req: Request) {
  const denied = requireSecret(req, env().VAANI_TOOL_SECRET)
  if (denied) return denied
  const parsed = await parseJson(req, AvailabilityBody)
  if ('response' in parsed) return parsed.response
  const b = parsed.data
  const slots = await findSlots(adminDb(), { visitType: b.visit_type, priority: b.priority, prefer: b.prefer, daysAhead: b.days_ahead, limit: b.limit })
  return json({ slots, count: slots.length })
}
