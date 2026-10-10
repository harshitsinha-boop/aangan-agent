/**
 * Replays eval transcripts through the REAL webhook -> ingest -> classify -> DB -> handoff-email pipeline, with no Vaani
 * account needed. Needs a running app (npm run dev, or the Vercel URL) and a working .env.local (service-role key, Gemini,
 * Resend). Tags every call `sim-…` so supabase/sim-clean.sql can remove them. Emails go to EMAIL_TEST_REDIRECT.
 *   npx tsx --env-file=.env.local scripts/simulate-calls.ts T01 T05 T10 T14 [--base http://localhost:3000]
 */
import { createHash } from 'node:crypto'
import { callTime, FIXTURES } from '../evals/fixtures'

const args = process.argv.slice(2)
const bi = args.indexOf('--base')
const base = bi > -1 ? args.splice(bi, 2)[1] : 'http://localhost:3000'
const ids = args.length ? args : ['T01', 'T10', 'T14']
const secret = process.env.VAANI_WEBHOOK_SECRET
if (!secret) { console.error('VAANI_WEBHOOK_SECRET is not set'); process.exit(1) }

async function main() {
  for (const id of ids) {
    const f = FIXTURES.find((x) => x.id === id)
    if (!f) { console.error(`no fixture ${id}`); continue }
    const phone = '+9190' + (parseInt(createHash('sha1').update(id).digest('hex').slice(0, 7), 16) % 100_000_000).toString().padStart(8, '0')
    const callId = `sim-${id}-${Date.now()}`
    const body = {
      event: 'call_postprocessing', timestamp: callTime(f).toISOString(),
      data: { room_name: callId, call_id: callId, call_duration: 240_000, transcript: f.transcript, summary: null, phone_number: phone, end_reason: 'Call ended' },
    }
    const r = await fetch(`${base}/api/vaani/webhook?token=${encodeURIComponent(secret!)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    console.log(`${id} -> ${r.status} (${callId}); ingestion runs after the response, check the dashboard in ~10s`)
  }
}
main()
