import { env } from '@/lib/env'

const BASE = 'https://api.vaanivoice.ai'

async function vaani<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = env().VAANI_API_KEY
  if (!key) throw new Error('VAANI_API_KEY is not set')
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Vaani ${init.method ?? 'GET'} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

export type VaaniCallDetails = {
  transcription?: string
  entity?: Record<string, unknown> | string
  summary?: string
  call_eval_tag?: string | null
}

export const getCallDetails = (callId: string) =>
  vaani<VaaniCallDetails>(`/api/call_details/${encodeURIComponent(callId)}`)

export const getCallHistory = (page = 1, pageSize = 50) =>
  vaani<{ data?: Record<string, unknown>[]; pagination?: unknown }>(`/api/call-history?page=${page}&page_size=${pageSize}`)

/** Outbound telephony call (used for the escalation fallback call). */
export async function triggerCall(p: {
  agentId: string
  contactNumber: string
  name: string
  metadata?: Record<string, unknown>
}): Promise<{ callId: string | null }> {
  const r = await vaani<{ output?: { call_id?: string } }>('/api/trigger-call/', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: p.agentId,
      medium: 'telephony',
      contact_number: p.contactNumber,
      name: p.name,
      metadata: p.metadata ?? {},
      dnd_check_skipped: true, // internal alert to the studio head, not marketing
    }),
  })
  return { callId: r.output?.call_id ?? null }
}
