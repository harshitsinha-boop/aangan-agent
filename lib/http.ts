import { timingSafeEqual } from 'node:crypto'
import type { ZodType } from 'zod'

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Accepts `Authorization: Bearer <secret>` or `x-aangan-secret: <secret>`. Returns a 401 Response or null. */
export function requireSecret(req: Request, expected: string): Response | null {
  const auth = req.headers.get('authorization')
  const given = auth?.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-aangan-secret')
  if (!given || !safeEqual(given, expected)) return json({ error: 'unauthorized' }, 401)
  return null
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { response: Response }> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { response: json({ error: 'invalid_json' }, 400) }
  }
  // Voice-agent tool calls routinely send "" or null for "not provided". Treat those as absent.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== '' && v !== null && v !== undefined))
  }
  const r = schema.safeParse(raw)
  if (!r.success) {
    return { response: json({ error: 'invalid_input', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 422) }
  }
  return { data: r.data }
}
