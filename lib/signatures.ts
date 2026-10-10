import { createHmac } from 'node:crypto'
import { safeEqual } from '@/lib/http'

const TOLERANCE_S = 300

/** Vaani: X-Vaani-Signature = "sha256=" + HMAC_SHA256(secret, `${timestamp}.${rawBody}`), X-Vaani-Timestamp in seconds. */
export function verifyVaaniSignature(rawBody: string, signature: string | null, timestamp: string | null, secret: string, nowS = Date.now() / 1000): boolean {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(nowS - Number(timestamp)) > TOLERANCE_S) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return safeEqual(expected, signature)
}

/** Resend signs webhooks with Svix: headers svix-id / svix-timestamp / svix-signature ("v1,<base64>" space-separated list). */
export function verifySvixSignature(
  rawBody: string,
  h: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowS = Date.now() / 1000,
): boolean {
  if (!h.id || !h.timestamp || !h.signature || !/^\d+$/.test(h.timestamp)) return false
  if (Math.abs(nowS - Number(h.timestamp)) > TOLERANCE_S) return false
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  const expected = createHmac('sha256', key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest('base64')
  return h.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    return version === 'v1' && !!sig && safeEqual(sig, expected)
  })
}
