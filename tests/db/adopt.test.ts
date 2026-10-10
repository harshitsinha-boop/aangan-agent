import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './helpers'

let db: PGlite
beforeAll(async () => { db = await makeDb({ seed: true }) })
afterAll(() => db.close())
const one = async <T = Record<string, unknown>>(q: string) => (await db.query<T>(q)).rows[0]
const adopt = async (real: string, phone: string | null) =>
  (await one<{ a: string | null }>(`select public.adopt_tool_call('${real}', ${phone ? `'${phone}'` : 'null'}) a`)).a
const caller = async (phone: string) => (await one<{ id: string }>(`insert into callers (phone) values ('${phone}') returning id`)).id

describe('adopt_tool_call: tool-keyed calls are folded into the real Vaani call', () => {
  it('renames a tool-created call to the real id and keeps its lead', async () => {
    const c = await caller('+919111111111')
    const call = await one<{ id: string }>(`insert into calls (vaani_call_id, caller_id) values ('tool-919111111111-1', '${c}') returning id`)
    await db.exec(`insert into leads (call_id, caller_id, location) values ('${call.id}', '${c}', 'Baner')`)
    expect(await adopt('real-1', '+919111111111')).toBe(call.id)
    expect((await one<{ vaani_call_id: string }>(`select vaani_call_id from calls where id = '${call.id}'`)).vaani_call_id).toBe('real-1')
    expect((await one<{ n: number }>(`select count(*)::int n from leads where call_id = '${call.id}'`)).n).toBe(1)
  })

  it('merges into an existing real row (webhook events came first): lead + escalation move, synthetic row removed', async () => {
    const c = await caller('+919222222222')
    const syn = await one<{ id: string }>(`insert into calls (vaani_call_id, caller_id, intent, outcome) values ('tool-919222222222-1', '${c}', 'complaint', 'escalated') returning id`)
    await db.exec(`insert into escalations (call_id, client_name, sent_at) values ('${syn.id}', 'X', now())`)
    const real = await one<{ id: string }>(`insert into calls (vaani_call_id, started_at) values ('real-2', now()) returning id`)
    expect(await adopt('real-2', '+919222222222')).toBe(real.id)
    expect((await one<{ n: number }>(`select count(*)::int n from escalations where call_id = '${real.id}'`)).n).toBe(1)
    expect((await one<{ n: number }>(`select count(*)::int n from calls where id = '${syn.id}'`)).n).toBe(0)
    const merged = await one<{ caller_id: string; outcome: string }>(`select caller_id, outcome from calls where id = '${real.id}'`)
    expect(merged).toMatchObject({ caller_id: c, outcome: 'escalated' })
  })

  it('never adopts another caller\'s call, an old call, or an already-processed one', async () => {
    const c = await caller('+919333333333')
    await db.exec(`insert into calls (vaani_call_id, caller_id, created_at) values ('tool-919333333333-1', '${c}', now() - interval '5 hours')`)
    await db.exec(`insert into calls (vaani_call_id, caller_id, transcript) values ('tool-919333333333-2', '${c}', 'already processed')`)
    expect(await adopt('real-3', '+919444444444')).toBeNull() // different caller, no real row
    expect(await adopt('real-3', '+919333333333')).toBeNull() // only an old one and a processed one
  })

  it('without a phone it adopts only when exactly one recent candidate exists', async () => {
    await db.exec(`delete from calls where vaani_call_id like 'tool-%'`)
    await db.exec(`insert into calls (vaani_call_id) values ('tool-919555555555-1')`)
    await db.exec(`insert into calls (vaani_call_id) values ('tool-919666666666-1')`)
    expect(await adopt('real-4', null)).toBeNull() // ambiguous: two callers
    await db.exec(`delete from calls where vaani_call_id = 'tool-919666666666-1'`)
    expect(await adopt('real-4', null)).not.toBeNull()
  })

  it('is not callable from a browser role', async () => {
    await db.exec('set role authenticated')
    try { await expect(db.query(`select public.adopt_tool_call('x')`)).rejects.toThrow(/permission denied/) } finally { await db.exec('reset role') }
  })
})
