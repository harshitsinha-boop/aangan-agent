import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './helpers'

const ADMIN = '00000000-0000-0000-0000-0000000000aa'
const NOBODY = '00000000-0000-0000-0000-0000000000bb'
let db: PGlite

type M = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
async function metrics(uid: string, args = "'2026-10-01', '2026-11-01'"): Promise<M> {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${uid}', false);`)
  try { return (await db.query<{ m: M }>(`select public.dashboard_metrics(${args}) m`)).rows[0].m } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  db = await makeDb({ seed: true })
  await db.exec(`insert into admin_users (user_id, email) values ('${ADMIN}', 'n@x.invalid')`)
  // rates: ₹1 per telephony minute, ₹0.5 per email
  await db.exec(`update cost_rates set inr_per_unit = 1 where component = 'telephony_min'; update cost_rates set inr_per_unit = 0.5 where component = 'email'`)
  await db.exec(`
    insert into calls (vaani_call_id, started_at, rang_at, answered_at, duration_s, after_hours, outcome, decline_reason, intent) values
      ('q1', '2026-10-05 05:00+00', '2026-10-05 05:00:00+00', '2026-10-05 05:00:02+00', 120, false, 'qualified', null, 'new_lead'),
      ('q2', '2026-10-06 18:00+00', '2026-10-06 18:00:00+00', '2026-10-06 18:00:04+00', 300, true,  'qualified_with_note', null, 'new_lead'),
      ('d1', '2026-10-07 06:00+00', null, null, 60, false, 'declined', 'area', 'new_lead'),
      ('d2', '2026-10-07 07:00+00', null, null, 60, false, 'declined', 'area', 'new_lead'),
      ('d3', '2026-10-08 18:30+00', null, null, 60, true,  'declined', 'budget', 'new_lead'),
      ('e1', '2026-10-09 06:00+00', null, null, 180, false, 'escalated', null, 'complaint'),
      ('old', '2026-09-20 06:00+00', null, null, 600, false, 'qualified', null, 'new_lead');
    insert into leads (call_id, project_value_inr, status, priority)
      select id, 900000, 'consult_booked', false from calls where vaani_call_id = 'q1';
    insert into leads (call_id, project_value_inr, status)  -- after-hours lead: booked, value unknown yet
      select id, null, 'accepted' from calls where vaani_call_id = 'q2';
    insert into escalations (call_id, sent_at, acknowledged_at, fallback_call_at)
      select id, '2026-10-09 06:00+00', '2026-10-09 06:07+00', null from calls where vaani_call_id = 'e1';
  `)
  const d = (await db.query<{ id: string }>('select id from designers limit 1')).rows[0].id
  const slot = async (n: number) => (await db.query<{ id: string }>(`insert into availability_slots (designer_id, slot_start, slot_end, visit_type) values ('${d}', now() + interval '${n} days', now() + interval '${n} days 1 hour', 'site') returning id`)).rows[0].id
  for (const call of ['q1', 'q2']) {
    const lead = (await db.query<{ id: string }>(`select l.id from leads l join calls c on c.id = l.call_id where c.vaani_call_id = '${call}'`)).rows[0].id
    await db.exec(`select public.book_slot('${await slot(call === 'q1' ? 3 : 4)}', '${lead}')`)
    await db.exec(`insert into handoffs (lead_id, designer_id, sent_at, accepted_at) values ('${lead}', '${d}', '2026-10-06 10:00+00', '${call === 'q1' ? '2026-10-06 10:30+00' : '2026-10-06 11:30+00'}')`)
  }
  await db.exec(`
    insert into call_costs (call_id, component, units, inr) select id, 'telephony_min', 2, 2 from calls where vaani_call_id = 'q1';
    insert into call_costs (call_id, component, units, inr) select id, 'telephony_min', 5, 5 from calls where vaani_call_id = 'q2';
    insert into email_events (email_message_id, type, occurred_at) values
      ('m1', 'sent', '2026-10-05 05:10+00'), ('m1', 'sent', '2026-10-05 05:10:01+00'), ('m2', 'sent', '2026-10-06 18:10+00'),
      ('m2', 'bounced', '2026-10-06 18:11+00');
  `)
})
afterAll(() => db.close())

describe('dashboard_metrics', () => {
  it('counts calls, after-hours share, outcomes and decline reasons inside the range only', async () => {
    const m = await metrics(ADMIN)
    expect(m.calls_answered).toBe(6) // 'old' (September) excluded
    expect(m.after_hours_calls).toBe(2)
    expect(m.after_hours_pct).toBe(33.3)
    expect(m.outcomes).toEqual({ qualified: 1, qualified_with_note: 1, declined: 3, escalated: 1 })
    expect(m.decline_reasons).toEqual({ area: 2, budget: 1 })
  })
  it('median time to answer uses only calls that have both timestamps', async () =>
    expect((await metrics(ADMIN)).median_time_to_answer_s).toBe(3)) // median of 2s and 4s
  it('consultations, designer pickup, escalations', async () => {
    const m = await metrics(ADMIN)
    expect(m.consultations_booked).toBe(2)
    expect(m.designer_pickup).toMatchObject({ median_minutes: 60, accepted: 2, waiting: 0 }) // median of 30 and 90 min
    expect(m.escalations).toMatchObject({ total: 1, acknowledged: 1, unacknowledged: 0, median_minutes_to_ack: 7, fallback_calls: 0 })
  })
  it('bounces are distinct emails; pipeline excludes lost and reports leads with no value', async () => {
    const m = await metrics(ADMIN)
    expect(m.email_bounces.count).toBe(1)
    expect(m.pipeline).toMatchObject({ value_inr: 900000, missing_value: 1 })
    expect(m.conversion).toMatchObject({ leads: 2, won: 0, pct: 0 })
  })
  it('headline: after-hours booked leads, valued and counted separately', async () => {
    const m = await metrics(ADMIN)
    expect(m.after_hours_booked).toMatchObject({ leads: 1, value_inr: 0, missing_value: 1 }) // q2 only, value not entered yet
    await db.exec(`update leads set project_value_inr = 600000 where call_id = (select id from calls where vaani_call_id = 'q2')`)
    expect((await metrics(ADMIN)).after_hours_booked).toMatchObject({ leads: 1, value_inr: 600000, missing_value: 0 })
  })
  it('cost = call costs + distinct emails x email rate; unit costs divide correctly', async () => {
    const m = await metrics(ADMIN)
    expect(m.cost.by_component).toMatchObject({ telephony_min: 7, email: 1 }) // 2 distinct emails x 0.5
    expect(m.cost.total_inr).toBe(8)
    expect(m.cost.per_call).toBe(1.33)
    expect(m.cost.per_qualified_lead).toBe(4) // 8 / 2 qualified outcomes
    expect(m.cost.per_booked_consultation).toBe(4)
    expect(m.cost.rates_configured).toBe(true)
  })
  it('filters: after-hours only, and outcome', async () => {
    const ah = await metrics(ADMIN, "'2026-10-01', '2026-11-01', true")
    expect(ah.calls_answered).toBe(2); expect(ah.after_hours_pct).toBe(100)
    const dec = await metrics(ADMIN, "'2026-10-01', '2026-11-01', false, 'declined'")
    expect(dec.calls_answered).toBe(3); expect(dec.decline_reasons).toEqual({ area: 2, budget: 1 })
  })
  it('an empty range returns nulls, not division errors', async () => {
    const m = await metrics(ADMIN, "'2027-01-01', '2027-02-01'")
    expect(m.calls_answered).toBe(0); expect(m.after_hours_pct).toBeNull(); expect(m.cost.per_call).toBeNull(); expect(m.conversion.pct).toBeNull()
  })
  it('a signed-in non-admin sees no data (RLS), and anon cannot call it at all', async () => {
    expect((await metrics(NOBODY)).calls_answered).toBe(0)
    await db.exec('set role anon')
    try { await expect(db.query(`select public.dashboard_metrics('2026-10-01','2026-11-01')`)).rejects.toThrow(/permission denied/) } finally { await db.exec('reset role') }
  })
})
