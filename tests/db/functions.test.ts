import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './helpers'

let db: PGlite
const one = async <T = Record<string, unknown>>(q: string) => (await db.query<T>(q)).rows[0]
const FUTURE = "now() + interval '1 hour'"

async function newLead(opts: { priority?: boolean } = {}) {
  const n = Math.random().toString(36).slice(2)
  const call = await one<{ id: string }>(`insert into calls (vaani_call_id) values ('c-${n}') returning id`)
  return (await one<{ id: string }>(
    `insert into leads (call_id, priority) values ('${call.id}', ${opts.priority ?? false}) returning id`)).id
}
const token = async (action: string, table: string, target: string, hash: string, expires = FUTURE, recipient = 'x@y') =>
  db.exec(`insert into action_tokens (token_hash, action, target_table, target_id, expires_at, recipient)
           values ('${hash}', '${action}', '${table}', '${target}', ${expires}, '${recipient}')`)
const apply = async (hash: string) =>
  (await one<{ apply_action_token: Record<string, unknown> }>(`select public.apply_action_token('${hash}')`)).apply_action_token

beforeAll(async () => { db = await makeDb({ seed: true }) })
afterAll(() => db.close())

describe('pick_designer / create_handoff', () => {
  it('priority leads go to the principal, others to a non-principal', async () => {
    const pri = await newLead({ priority: true })
    const std = await newLead()
    const h1 = await one<{ is_principal: boolean }>(
      `select d.is_principal from designers d where d.id = public.pick_designer('${pri}')`)
    const h2 = await one<{ is_principal: boolean }>(
      `select d.is_principal from designers d where d.id = public.pick_designer('${std}')`)
    expect(h1.is_principal).toBe(true)
    expect(h2.is_principal).toBe(false)
  })

  it('create_handoff is idempotent and moves the lead to handed_off', async () => {
    const lead = await newLead()
    const a = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    const b = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    expect(a).toBe(b)
    expect((await one<{ status: string }>(`select status from leads where id='${lead}'`)).status).toBe('handed_off')
  })

  it('balances load across non-principal designers', async () => {
    const owners = new Set<string>()
    for (let i = 0; i < 4; i++) {
      const lead = await newLead()
      const h = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
      owners.add((await one<{ designer_id: string }>(`select designer_id from handoffs where id='${h}'`)).designer_id)
    }
    expect(owners.size).toBeGreaterThan(1)
  })
})

describe('apply_action_token: handoffs', () => {
  it('accept applies once; replaying the same link is rejected as used', async () => {
    const lead = await newLead()
    const h = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    await token('accept', 'handoffs', h, 'acc1')
    expect(await apply('acc1')).toMatchObject({ ok: true, code: 'accepted' })
    expect((await one<{ accepted_at: string }>(`select accepted_at from handoffs where id='${h}'`)).accepted_at).toBeTruthy()
    expect((await one<{ status: string }>(`select status from leads where id='${lead}'`)).status).toBe('accepted')
    expect(await apply('acc1')).toMatchObject({ ok: false, code: 'used' })
  })

  it('rejects expired and unknown tokens without changing anything', async () => {
    const lead = await newLead()
    const h = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    await token('accept', 'handoffs', h, 'exp1', "now() - interval '1 second'")
    expect(await apply('exp1')).toMatchObject({ ok: false, code: 'expired' })
    expect(await apply('nope')).toMatchObject({ ok: false, code: 'invalid' })
    expect((await one<{ accepted_at: string | null }>(`select accepted_at from handoffs where id='${h}'`)).accepted_at).toBeNull()
  })

  it('reassign closes the old handoff, opens one for the principal, and kills the old accept link', async () => {
    const lead = await newLead()
    const h = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    await token('reassign', 'handoffs', h, 're1')
    await token('accept', 'handoffs', h, 'acc2')
    const r = await apply('re1')
    expect(r).toMatchObject({ ok: true, code: 'reassigned' })
    const live = await one<{ is_principal: boolean; id: string }>(
      `select d.is_principal, h.id from handoffs h join designers d on d.id = h.designer_id
        where h.lead_id='${lead}' and h.reassigned_at is null`)
    expect(live.is_principal).toBe(true)
    expect(live.id).toBe(r.new_handoff_id)
    expect(await apply('acc2')).toMatchObject({ ok: false, code: 'superseded' })
  })

  it('reassign is refused after the handoff was accepted (token stays unused)', async () => {
    const lead = await newLead()
    const h = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    await token('accept', 'handoffs', h, 'acc3')
    await token('reassign', 'handoffs', h, 're3')
    await apply('acc3')
    expect(await apply('re3')).toMatchObject({ ok: false, code: 'already_accepted' })
    expect((await one<{ used_at: string | null }>(`select used_at from action_tokens where token_hash='re3'`)).used_at).toBeNull()
  })

  it('a token only touches its own record', async () => {
    const l1 = await newLead(); const l2 = await newLead()
    const h1 = (await one<{ create_handoff: string }>(`select public.create_handoff('${l1}')`)).create_handoff
    const h2 = (await one<{ create_handoff: string }>(`select public.create_handoff('${l2}')`)).create_handoff
    await token('accept', 'handoffs', h1, 'acc4')
    await apply('acc4')
    expect((await one<{ accepted_at: string | null }>(`select accepted_at from handoffs where id='${h2}'`)).accepted_at).toBeNull()
  })

  it('an accept link cannot be turned into a different action', async () => {
    const lead = await newLead()
    const h = (await one<{ create_handoff: string }>(`select public.create_handoff('${lead}')`)).create_handoff
    await token('acknowledge', 'handoffs', h, 'bad1') // acknowledge is not valid for handoffs
    expect(await apply('bad1')).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('apply_action_token: escalations', () => {
  it('first acknowledger becomes owner; the second is told who has it', async () => {
    const call = await one<{ id: string }>(`insert into calls (vaani_call_id) values ('esc-1') returning id`)
    const esc = await one<{ id: string }>(`insert into escalations (call_id, sent_at) values ('${call.id}', now()) returning id`)
    await token('acknowledge', 'escalations', esc.id, 'ack1', FUTURE, 'nikhil@example.invalid')
    await token('acknowledge', 'escalations', esc.id, 'ack2', FUTURE, 'aryan@example.invalid')
    expect(await apply('ack1')).toMatchObject({ ok: true, code: 'acknowledged', by: 'nikhil@example.invalid' })
    expect(await apply('ack2')).toMatchObject({ ok: false, code: 'already_acknowledged', by: 'nikhil@example.invalid' })
    expect((await one<{ acknowledged_by: string }>(`select acknowledged_by from escalations where id='${esc.id}'`)).acknowledged_by)
      .toBe('nikhil@example.invalid')
  })
})

describe('permissions', () => {
  it('functions are not callable by browser roles', async () => {
    await db.exec('set role authenticated')
    try {
      await expect(db.query(`select public.apply_action_token('x')`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.create_handoff(gen_random_uuid())`)).rejects.toThrow(/permission denied/)
    } finally { await db.exec('reset role') }
  })
})
