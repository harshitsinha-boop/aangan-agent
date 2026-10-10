import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { makeDb, sql } from './helpers'

let db: PGlite
beforeAll(async () => { db = await makeDb({ seed: true }) })
afterAll(() => db.close())

const count = async (t: string) => Number((await db.query<{ n: number }>(`select count(*)::int n from public.${t}`)).rows[0].n)

describe('demo data scripts', () => {
  it('seed loads, feeds the metrics, and clean removes every trace', async () => {
    await db.exec(sql('demo-seed.sql'))
    expect(await count('calls')).toBe(8)
    const m = (await db.query<{ m: Record<string, any> }>(`select public.dashboard_metrics(now() - interval '10 days', now() + interval '1 day') m`)).rows[0].m // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(m.calls_answered).toBe(8)
    expect(m.outcomes.declined).toBe(3)
    expect(m.escalations.fallback_calls).toBe(1)
    expect(m.email_bounces.count).toBe(1)
    expect(m.cost.rates_configured).toBe(true)
    expect(m.after_hours_booked.leads).toBeGreaterThanOrEqual(1)

    await db.exec(sql('demo-clean.sql'))
    for (const t of ['calls', 'callers', 'leads', 'handoffs', 'consultations', 'escalations', 'call_costs', 'email_events']) expect(await count(t), t).toBe(0)
    expect(Number((await db.query<{ n: number }>('select count(*)::int n from public.cost_rates where inr_per_unit > 0')).rows[0].n)).toBe(0)
    expect(await count('designers')).toBeGreaterThan(0) // reference data untouched
  })
})
