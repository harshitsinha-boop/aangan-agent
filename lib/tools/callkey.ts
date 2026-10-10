import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'

/**
 * The key a tool call files its work under. Normally Vaani's call id. If Vaani does not give the tool one, fall back to a key
 * derived from the caller's number: reuse this caller's tool-created call from the last 90 minutes (so lookup, book and escalate
 * in ONE call share a record), else start a new one. The post-call webhook later adopts it into the real call
 * (adopt_tool_call in migration 09).
 */
export async function resolveCallKey(db: Db, vaaniCallId: string | undefined, phone: string): Promise<string> {
  if (vaaniCallId) return vaaniCallId
  const digits = phone.replace(/\D/g, '')
  const since = new Date(Date.now() - 90 * 60_000).toISOString()
  const rows = must<{ vaani_call_id: string }[]>(
    await db.from('calls').select('vaani_call_id').like('vaani_call_id', `tool-${digits}-%`).gte('created_at', since).is('transcript', null)
      .order('created_at', { ascending: false }).limit(1),
    'find tool call',
  )
  return rows[0]?.vaani_call_id ?? `tool-${digits}-${Date.now()}`
}
