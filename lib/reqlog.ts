import type { Db } from '@/lib/supabase/admin'

const SAFE_HEADERS = ['content-type', 'user-agent', 'x-vaani-timestamp', 'x-forwarded-for', 'x-vercel-id']

/** Best-effort diagnostic log of an incoming request. Never throws, never stores credentials. */
export async function logRequest(db: Db, route: string, status: number, body: unknown, headers: Headers, note?: string): Promise<void> {
  try {
    let b: unknown = body
    const s = JSON.stringify(body ?? null)
    if (s.length > 20_000) b = { truncated: true, preview: s.slice(0, 20_000) }
    await db.from('request_log').insert({
      route, status, body: b as object,
      headers: Object.fromEntries(SAFE_HEADERS.map((h) => [h, headers.get(h)]).filter(([, v]) => v)),
      note: note ?? null,
    })
  } catch { /* diagnostics must never break a call */ }
}
