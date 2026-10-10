import { env } from '@/lib/env'
import { json } from '@/lib/http'
import { verifySvixSignature } from '@/lib/signatures'
import { adminDb } from '@/lib/supabase/admin'

const TYPES: Record<string, 'sent' | 'delivered' | 'opened' | 'bounced' | 'complained'> = {
  'email.sent': 'sent', 'email.delivered': 'delivered', 'email.opened': 'opened', 'email.bounced': 'bounced', 'email.complained': 'complained',
}

/** Resend delivery events (Svix-signed). Idempotent: replays are ignored. A bounce becomes a dashboard alert (Phase 5 reads email_events). */
export async function POST(req: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET
  if (!secret) return json({ error: 'webhook_not_configured' }, 503)
  const raw = await req.text()
  const ok = verifySvixSignature(raw, {
    id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature'),
  }, secret)
  if (!ok) return json({ error: 'invalid_signature' }, 401)

  let evt: { type?: string; created_at?: string; data?: { email_id?: string } }
  try { evt = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }
  const type = evt.type ? TYPES[evt.type] : undefined
  const messageId = evt.data?.email_id
  if (!type || !messageId) return json({ ok: true, ignored: true })

  const db = adminDb()
  const occurredAt = evt.created_at ?? new Date().toISOString()
  const ins = await db.from('email_events').upsert(
    { email_message_id: messageId, type, occurred_at: occurredAt, payload: evt as object },
    { onConflict: 'email_message_id,type,occurred_at', ignoreDuplicates: true },
  )
  if (ins.error) return json({ error: 'internal' }, 500)

  if (type === 'delivered' || type === 'opened') {
    const col = type === 'delivered' ? 'delivered_at' : 'opened_at'
    await db.from('handoffs').update({ [col]: occurredAt }).eq('email_message_id', messageId).is(col, null)
  }
  return json({ ok: true })
}
