import { createHmac, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'

export type TokenAction = 'accept' | 'reassign' | 'acknowledge'
export type TokenTarget = 'handoffs' | 'escalations'

/** Only this keyed hash is stored. A DB leak alone yields neither usable links nor a way to forge new ones. */
export const hashToken = (token: string) =>
  createHmac('sha256', env().ACTION_TOKEN_SECRET).update(token).digest('hex')

export const actionUrl = (token: string) => `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/actions/${token}`

export async function mintToken(
  db: Db,
  p: { action: TokenAction; targetTable: TokenTarget; targetId: string; recipient?: string; ttlHours: number },
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  must(
    await db.from('action_tokens').insert({
      token_hash: hashToken(token),
      action: p.action,
      target_table: p.targetTable,
      target_id: p.targetId,
      recipient: p.recipient ?? null,
      expires_at: new Date(Date.now() + p.ttlHours * 3_600_000).toISOString(),
    }),
    'mint token',
  )
  return token
}

export type PeekResult =
  | { status: 'valid'; action: TokenAction; targetTable: TokenTarget; targetId: string; recipient: string | null }
  | { status: 'invalid' | 'used' | 'expired' | 'superseded'; action?: TokenAction }

/** Read-only look at a token. Used by the GET confirmation page, which must never change data. */
export async function peekToken(db: Db, token: string): Promise<PeekResult> {
  const row = must(
    await db.from('action_tokens').select('action,target_table,target_id,recipient,expires_at,used_at').eq('token_hash', hashToken(token)).maybeSingle(),
    'peek token',
  )
  if (!row) return { status: 'invalid' }
  const action = row.action as TokenAction
  if (row.used_at) return { status: 'used', action }
  if (new Date(row.expires_at) <= new Date()) return { status: 'expired', action }
  if (row.target_table === 'handoffs') {
    const h = must(await db.from('handoffs').select('reassigned_at').eq('id', row.target_id).maybeSingle(), 'peek handoff')
    if (h?.reassigned_at) return { status: 'superseded', action }
  }
  return { status: 'valid', action, targetTable: row.target_table, targetId: row.target_id, recipient: row.recipient }
}

export type ApplyResult = { ok: boolean; code: string; [k: string]: unknown }

/** Atomically validates, applies and burns the token (see apply_action_token in migration 06). */
export async function applyToken(db: Db, token: string): Promise<ApplyResult> {
  const r = await db.rpc('apply_action_token', { p_hash: hashToken(token) })
  return must(r, 'apply token') as ApplyResult
}
