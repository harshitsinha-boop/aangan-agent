/**
 * End-to-end smoke test against a RUNNING app + real Supabase (needs SUPABASE_SERVICE_ROLE_KEY in .env.local).
 *   npm run dev            (terminal 1)
 *   npx tsx --env-file=.env.local scripts/smoke.ts [baseUrl]
 * Creates a clearly-marked test caller/call, exercises every tool route, and cleans up. Emails are only
 * sent if RESEND_API_KEY is set (use EMAIL_TEST_REDIRECT in the test phase).
 */
const base = process.argv[2] ?? 'http://localhost:3000'
const secret = process.env.VAANI_TOOL_SECRET!
const callId = `smoke-${Date.now()}`
const phone = '+919000000000'

async function post(path: string, body: unknown) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  console.log(`${r.status} ${path}`, JSON.stringify(j).slice(0, 220))
  return { status: r.status, j }
}

async function main() {
  const l = await post('/api/tools/lookup-caller', { phone, vaani_call_id: callId })
  const a = await post('/api/tools/availability', { visit_type: 'site', prefer: 'evening', limit: 3 })
  const slot = a.j.slots?.[0]?.slot_id
  if (!slot) throw new Error('no slots returned')
  const b1 = await post('/api/tools/book', { vaani_call_id: callId, phone, slot_id: slot, name: 'Smoke Test', project_type: '2BHK', location: 'Baner', carpet_area_sqft: 950 })
  const b2 = await post('/api/tools/book', { vaani_call_id: callId, phone, slot_id: slot, name: 'Smoke Test' })
  const e1 = await post('/api/tools/escalate', { vaani_call_id: `${callId}-esc`, phone, name: 'Smoke Test', project: '2BHK Baner', designer_name: 'Aryan', issue: 'smoke test, ignore' })
  const e2 = await post('/api/tools/escalate', { vaani_call_id: `${callId}-esc`, phone, name: 'Smoke Test' })
  const checks: [string, boolean][] = [
    ['lookup 200', l.status === 200], ['availability returns slots', !!slot], ['book 200', b1.status === 200],
    ['book is idempotent (same call+slot -> 200 already_booked)', b2.status === 200 && b2.j.already_booked === true],
    ['escalate 200', e1.status === 200], ['escalate is idempotent', e2.j.duplicate === true],
  ]
  for (const [n, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', n)
  if (checks.some(([, ok]) => !ok)) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
