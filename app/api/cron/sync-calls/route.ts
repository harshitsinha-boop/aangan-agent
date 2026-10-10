import { env } from '@/lib/env'
import { json, requireSecret } from '@/lib/http'
import { ingestCall, isOurOutboundCall, type CallData } from '@/lib/ingest'
import { normalizePhone } from '@/lib/phone'
import { adminDb, must } from '@/lib/supabase/admin'
import { getCallHistory } from '@/lib/vaani'

export const maxDuration = 60
const MAX_PER_RUN = 5
const SETTLE_MS = 3 * 60_000

/** Safety net for missed post-call webhooks: backfill recent calls that never got a transcript/classification. */
export async function POST(req: Request) {
  const denied = requireSecret(req, env().CRON_SECRET)
  if (denied) return denied
  if (!env().VAANI_API_KEY) return json({ ok: true, skipped: 'VAANI_API_KEY not set' })

  const db = adminDb()
  const history = await getCallHistory(1, 50)
  const items = (history.data ?? []).map((r) => ({ id: (r.call_id ?? (r.raw as Record<string, unknown> | undefined)?.call_id) as string | undefined, raw: (r.raw ?? r) as Record<string, unknown> }))
    .filter((x): x is { id: string; raw: Record<string, unknown> } => typeof x.id === 'string')
  if (!items.length) return json({ ok: true, checked: 0, ingested: 0 })

  const known = must<{ vaani_call_id: string; transcript: string | null }[]>(
    await db.from('calls').select('vaani_call_id,transcript').in('vaani_call_id', items.map((i) => i.id)), 'known calls',
  )
  const done = new Set(known.filter((k) => k.transcript).map((k) => k.vaani_call_id))
  let ingested = 0
  const errors: string[] = []
  for (const it of items) {
    if (ingested >= MAX_PER_RUN) break
    if (done.has(it.id) || (await isOurOutboundCall(db, it.id))) continue
    const status = String(it.raw.call_status ?? '')
    if (status && !/complete|ended|success/i.test(status)) continue // still in progress / never connected
    const ms = typeof it.raw.duration_ms === 'number' ? it.raw.duration_ms : null
    const phoneRaw = ['phone_number', 'caller_number', 'from_number', 'customer_number', 'contact_number'].map((k) => it.raw[k]).find((v) => typeof v === 'string') as string | undefined
    const ts = typeof it.raw.created_at === 'string' ? Date.parse(it.raw.created_at) : NaN
    if (!Number.isNaN(ts) && Date.now() - ts < SETTLE_MS) continue // webhook is probably still in flight
    const data: CallData = {
      callId: it.id, transcript: null, summary: null, durationSeconds: ms === null ? null : ms / 1000,
      phone: phoneRaw ? normalizePhone(phoneRaw) : null, endedAt: null, recordingUrl: null, raw: it.raw,
    }
    try { await ingestCall(db, data); ingested++ } catch (e) { errors.push(`${it.id}: ${(e as Error).message}`) }
  }
  return json({ ok: true, checked: items.length, ingested, errors })
}
