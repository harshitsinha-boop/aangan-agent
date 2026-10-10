import { describe, expect, it } from 'vitest'
import { POST as availability } from '@/app/api/tools/availability/route'
import { POST as book } from '@/app/api/tools/book/route'
import { POST as escalate } from '@/app/api/tools/escalate/route'
import { POST as lookup } from '@/app/api/tools/lookup-caller/route'
import { POST as sla } from '@/app/api/cron/sla-check/route'
import { POST as sync } from '@/app/api/cron/sync-calls/route'
import { POST as vaaniWebhook } from '@/app/api/vaani/webhook/route'
import { POST as emailWebhook } from '@/app/api/email/webhook/route'

const req = (body: unknown, headers: Record<string, string> = {}, url = 'https://app.example.com/x') =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const tool = { authorization: 'Bearer test-tool-secret-123456' }

describe.each([
  ['lookup-caller', lookup], ['availability', availability], ['book', book], ['escalate', escalate],
])('tool route %s', (_n, handler) => {
  it('401 without the shared secret', async () => expect((await handler(req({}))).status).toBe(401))
  it('401 with the wrong secret', async () => expect((await handler(req({}, { authorization: 'Bearer nope' }))).status).toBe(401))
  it('accepts the x-aangan-secret header form too (not 401)', async () =>
    expect((await handler(req('{bad', { 'x-aangan-secret': 'test-tool-secret-123456' }))).status).toBe(400))
  it('400 on invalid JSON', async () => expect((await handler(req('{bad', tool))).status).toBe(400))
})

describe('input validation (zod) happens before any database access', () => {
  it('book rejects a non-uuid slot', async () => {
    const r = await book(req({ phone: '9876543210', slot_id: 'not-a-uuid' }, tool))
    expect(r.status).toBe(422)
    const j = await r.json()
    expect(j.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['slot_id']))
  })
  it('book rejects a bad email', async () =>
    expect((await book(req({ vaani_call_id: 'c', phone: '9876543210', slot_id: crypto.randomUUID(), email: 'nope' }, tool))).status).toBe(422))
  it('availability rejects out-of-range limits', async () =>
    expect((await availability(req({ limit: 99 }, tool))).status).toBe(422))
  it('escalate requires a name', async () =>
    expect((await escalate(req({ vaani_call_id: 'c', phone: '9876543210' }, tool))).status).toBe(422))
  it('lookup-caller rejects a missing phone', async () => expect((await lookup(req({}, tool))).status).toBe(422))
})

describe('cron routes require the cron secret', () => {
  for (const [n, h] of [['sla-check', sla], ['sync-calls', sync]] as const) {
    it(`${n}: 401 without it, 401 with the tool secret`, async () => {
      expect((await h(req({}))).status).toBe(401)
      expect((await h(req({}, tool))).status).toBe(401)
    })
  }
})

describe('webhooks reject unsigned/unauthenticated requests', () => {
  it('vaani webhook: no token/signature -> 401; wrong token -> 401', async () => {
    expect((await vaaniWebhook(req({ event: 'call_ended' }))).status).toBe(401)
    expect((await vaaniWebhook(req({ event: 'call_ended' }, {}, 'https://app.example.com/api/vaani/webhook?token=wrong'))).status).toBe(401)
  })
  it('vaani webhook: a bad signature header is not rescued by a correct token', async () =>
    expect((await vaaniWebhook(req({}, { 'x-vaani-signature': 'sha256=bad', 'x-vaani-timestamp': String(Math.floor(Date.now() / 1000)) }, 'https://app.example.com/w?token=test-webhook-secret-12345'))).status).toBe(401))
  it('email webhook: 503 when unconfigured; 401 with a bad signature once configured', async () => {
    expect((await emailWebhook(req({}))).status).toBe(503)
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('k').toString('base64')
    const { resetEnvCache } = await import('@/lib/env')
    resetEnvCache()
    expect((await emailWebhook(req({}, { 'svix-id': 'm', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,xxxx' }))).status).toBe(401)
    delete process.env.RESEND_WEBHOOK_SECRET
    resetEnvCache()
  })
})
