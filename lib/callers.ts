import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'

export type CallerRow = { id: string; phone: string; name: string | null; email: string | null; is_existing_client: boolean }

/** Create or update a caller by E.164 phone. Never overwrites known data with nulls. */
export async function upsertCaller(
  db: Db,
  phone: string,
  patch: { name?: string | null; email?: string | null; is_existing_client?: boolean } = {},
): Promise<CallerRow> {
  const existing = must<CallerRow | null>(await db.from('callers').select('*').eq('phone', phone).maybeSingle(), 'find caller')
  if (!existing) {
    const r = await db
      .from('callers')
      .insert({ phone, name: patch.name ?? null, email: patch.email ?? null, is_existing_client: patch.is_existing_client ?? false })
      .select('*')
      .single()
    if (r.error?.code === '23505') return upsertCaller(db, phone, patch) // lost a race: update instead
    return must<CallerRow>(r, 'insert caller')
  }
  const upd: Record<string, unknown> = {}
  if (patch.name && patch.name !== existing.name) upd.name = patch.name
  if (patch.email && patch.email !== existing.email) upd.email = patch.email
  if (patch.is_existing_client && !existing.is_existing_client) upd.is_existing_client = true
  if (!Object.keys(upd).length) return existing
  return must<CallerRow>(await db.from('callers').update(upd).eq('id', existing.id).select('*').single(), 'update caller')
}

/** Ensure a calls row exists for this Vaani call (tools and webhooks can arrive in any order). */
export async function ensureCall(db: Db, vaaniCallId: string, patch: Record<string, unknown> = {}): Promise<{ id: string; caller_id: string | null }> {
  return must(
    await db.from('calls').upsert({ vaani_call_id: vaaniCallId, ...patch }, { onConflict: 'vaani_call_id' }).select('id,caller_id').single(),
    'ensure call',
  )
}
