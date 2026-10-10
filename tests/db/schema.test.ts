import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Applies the real migrations + seed to an in-process Postgres (PGlite), with just enough of
// Supabase stubbed (roles, auth.uid(), default grants). pg_cron/pg_net/vault are not in PGlite,
// so the cron migration is covered by review + the Supabase deploy, not this test.
const root = join(__dirname, '..', '..', 'supabase')
const sql = (p: string) => readFileSync(join(root, p), 'utf8')

const ADMIN = '00000000-0000-0000-0000-0000000000aa'
const NOBODY = '00000000-0000-0000-0000-0000000000bb'

let db: PGlite
const as = async (role: string, uid: string | null, q: string) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${uid ?? ''}', false);`)
  try {
    return await db.query(q)
  } finally {
    await db.exec('reset role;')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `)
  await db.exec(sql('migrations/20261010000001_schema.sql'))
  await db.exec(sql('migrations/20261010000002_rls.sql'))
  await db.exec(sql('migrations/20261010000004_rls_hardening.sql'))
  await db.exec(sql('seed.sql'))
  await db.exec(`insert into public.admin_users (user_id, email) values ('${ADMIN}', 'nikhil@example.invalid')`)
  await db.exec(`
    insert into public.callers (phone, name) values ('+919800000001', 'Priya');
    insert into public.calls (vaani_call_id, caller_id, outcome) select 'c1', id, 'qualified' from public.callers;
    insert into public.leads (call_id, caller_id) select c.id, c.caller_id from public.calls c;
    insert into public.action_tokens (token_hash, action, target_table, target_id, expires_at)
      values ('h', 'accept', 'handoffs', gen_random_uuid(), now() + interval '1 hour');
  `)
})
afterAll(() => db.close())

describe('RLS', () => {
  it('is enabled on every public table', async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )
    expect(r.rows).toEqual([])
  })

  it('anon cannot read anything', async () => {
    await expect(as('anon', null, 'select * from public.calls')).rejects.toThrow(/permission denied/)
    await expect(as('anon', null, 'select * from public.leads')).rejects.toThrow(/permission denied/)
  })

  it('a signed-in non-admin sees zero rows', async () => {
    for (const t of ['calls', 'leads', 'callers', 'config', 'designers']) {
      const r = await as('authenticated', NOBODY, `select * from public.${t}`)
      expect(r.rows, t).toHaveLength(0)
    }
  })

  it('an admin can read data and update leads, but not insert them', async () => {
    expect((await as('authenticated', ADMIN, 'select * from public.calls')).rows).toHaveLength(1)
    await as('authenticated', ADMIN, "update public.leads set status = 'won', project_value_inr = 900000")
    expect((await db.query<{ status: string }>('select status from public.leads')).rows[0].status).toBe('won')
    await expect(
      as('authenticated', ADMIN, 'insert into public.leads (caller_id) select id from public.callers'),
    ).rejects.toThrow(/permission denied/)
  })

  it('a non-admin cannot update leads', async () => {
    const r = await as('authenticated', NOBODY, "update public.leads set status = 'lost' returning id")
    expect(r.rows).toHaveLength(0)
  })

  it('action_tokens is unreadable by any browser role, even admins', async () => {
    await expect(as('authenticated', ADMIN, 'select * from public.action_tokens')).rejects.toThrow(/permission denied/)
    await expect(as('anon', null, 'select * from public.action_tokens')).rejects.toThrow(/permission denied/)
    expect((await as('service_role', null, 'select * from public.action_tokens')).rows).toHaveLength(1)
  })

  it('book_slot is not callable from the browser', async () => {
    await expect(
      as('authenticated', ADMIN, 'select public.book_slot(gen_random_uuid(), gen_random_uuid())'),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('constraints and helpers', () => {
  it('seeds config, one principal designer, and future slots', async () => {
    const keys = (await db.query<{ key: string }>('select key from public.config')).rows.map((r) => r.key)
    for (const k of ['min_completion_weeks', 'commercial_min_sqft', 'commercial_max_sqft', 'business_hours',
      'answer_mode', 'escalation_ack_minutes', 'handoff_accept_hours']) expect(keys).toContain(k)
    expect((await db.query("select 1 from public.designers where is_principal")).rows).toHaveLength(1)
    const s = await db.query<{ n: number; past: number }>(
      'select count(*)::int n, count(*) filter (where slot_start < now())::int past from public.availability_slots')
    expect(s.rows[0].n).toBeGreaterThan(100)
    expect(s.rows[0].past).toBe(0)
  })

  it('rejects non-E.164 phones and duplicate callers', async () => {
    await expect(db.exec("insert into public.callers (phone) values ('09800000001')")).rejects.toThrow()
    await expect(db.exec("insert into public.callers (phone) values ('+919800000001')")).rejects.toThrow()
  })

  it('only declined calls may carry a decline_reason', async () => {
    await expect(
      db.exec("insert into public.calls (vaani_call_id, outcome, decline_reason) values ('x', 'qualified', 'area')"),
    ).rejects.toThrow()
    await db.exec("insert into public.calls (vaani_call_id, outcome, decline_reason) values ('y', 'declined', 'area')")
  })

  it('vaani_call_id is unique (idempotent ingestion)', async () => {
    await expect(db.exec("insert into public.calls (vaani_call_id) values ('c1')")).rejects.toThrow()
  })

  it('book_slot books once, is idempotent per lead, and refuses a second lead', async () => {
    const slot = (await db.query<{ id: string }>('select id from public.availability_slots where not is_booked limit 1')).rows[0].id
    const lead1 = (await db.query<{ id: string }>('select id from public.leads limit 1')).rows[0].id
    await db.exec("update public.leads set status = 'accepted'")
    const a = await db.query<{ book_slot: { id: string } }>(`select public.book_slot('${slot}', '${lead1}')`)
    const b = await db.query<{ book_slot: { id: string } }>(`select public.book_slot('${slot}', '${lead1}')`)
    expect(b.rows[0].book_slot.id).toBe(a.rows[0].book_slot.id)
    expect((await db.query<{ status: string }>('select status from public.leads')).rows[0].status).toBe('consult_booked')

    await db.exec("insert into public.calls (vaani_call_id) values ('c2')")
    await db.exec("insert into public.leads (call_id) select id from public.calls where vaani_call_id = 'c2'")
    const lead2 = (await db.query<{ id: string }>("select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id = 'c2'")).rows[0].id
    await expect(db.query(`select public.book_slot('${slot}', '${lead2}')`)).rejects.toThrow(/slot_unavailable/)
  })

  it('allows only one live handoff per lead', async () => {
    const lead = (await db.query<{ id: string }>('select id from public.leads limit 1')).rows[0].id
    const d = (await db.query<{ id: string }>('select id from public.designers limit 2')).rows
    await db.exec(`insert into public.handoffs (lead_id, designer_id) values ('${lead}', '${d[0].id}')`)
    await expect(db.exec(`insert into public.handoffs (lead_id, designer_id) values ('${lead}', '${d[1].id}')`)).rejects.toThrow()
    await db.exec(`update public.handoffs set reassigned_at = now()`)
    await db.exec(`insert into public.handoffs (lead_id, designer_id) values ('${lead}', '${d[1].id}')`)
  })
})
