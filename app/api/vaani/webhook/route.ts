import { after } from 'next/server'
import { ensureCall, upsertCaller } from '@/lib/callers'
import { env } from '@/lib/env'
import { json, requireSecret, safeEqual } from '@/lib/http'
import { ingestCall, isOurOutboundCall, normalizePostprocessing } from '@/lib/ingest'
import { normalizePhone } from '@/lib/phone'
import { verifyVaaniSignature } from '@/lib/signatures'
import { logRequest } from '@/lib/reqlog'
import { adminDb } from '@/lib/supabase/admin'

export const maxDuration = 60

/**
 * Vaani call events. Auth: HMAC signature if Vaani sends one (documented for campaign webhooks), otherwise
 * the secret as `?token=` (register https://<app>/api/vaani/webhook?token=<VAANI_WEBHOOK_SECRET> in Vaani Settings > Webhooks).
 * Always acknowledges fast; the heavy work (classification, email) runs after the response, and the sync-calls
 * cron backfills anything that fails.
 */
export async function POST(req: Request) {
  const secret = env().VAANI_WEBHOOK_SECRET
  const raw = await req.text()
  const sig = req.headers.get('x-vaani-signature')
  const tokenParam = new URL(req.url).searchParams.get('token')
  const ok = sig
    ? verifyVaaniSignature(raw, sig, req.headers.get('x-vaani-timestamp'), secret)
    : (tokenParam !== null && safeEqual(tokenParam, secret)) || requireSecret(req, secret) === null
  if (!ok) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }
  const event = body.event
  const db = adminDb()
  // Vaani documents room_name/call_id at the top level (and under `data` for post-processing); accept either.
  const inner = typeof body.data === 'object' && body.data !== null ? (body.data as Record<string, unknown>) : {}
  const pick = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : typeof inner[k] === 'string' ? (inner[k] as string) : undefined)
  const roomName = pick('room_name') ?? pick('call_id')
  await logRequest(db, `webhook:${String(event)}`, 200, body, req.headers, roomName ? undefined : 'no room_name/call_id found')

  try {
    if (event === 'call_postprocessing') {
      const data = normalizePostprocessing(body)
      if (!data) return json({ error: 'missing_call_id' }, 422)
      after(async () => {
        try {
          if (await isOurOutboundCall(db, data.callId)) return
          await ingestCall(db, data)
        } catch (e) { console.error('ingest failed; sync-calls will retry', data.callId, e) }
      })
    } else if (roomName && (event === 'call_started' || event === 'user_picked_up_at' || event === 'call_ended')) {
      if (await isOurOutboundCall(db, roomName)) return json({ ok: true, ignored: 'own_outbound' })
      const now = new Date().toISOString()
      const patch: Record<string, unknown> = {}
      if (event === 'call_started') {
        patch.started_at = now; patch.rang_at = now
        const phone = typeof body.phone_number === 'string' ? normalizePhone(body.phone_number) : null
        if (phone) patch.caller_id = (await upsertCaller(db, phone)).id
      }
      if (event === 'user_picked_up_at') patch.answered_at = now
      if (event === 'call_ended') {
        patch.ended_at = now
        if (typeof body.call_duration === 'number') patch.duration_s = body.call_duration // seconds in this event
      }
      await ensureCall(db, roomName, patch)
    }
  } catch (e) {
    console.error('webhook handling failed', event, e)
    return json({ error: 'internal' }, 500) // Vaani retries with backoff
  }
  return json({ ok: true })
}
