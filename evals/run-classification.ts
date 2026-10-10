/**
 * LIVE classification eval: runs the real extraction step (Gemini) + the decision rules on every phone transcript and
 * compares with evals/expected.json. Exits 1 on any mismatch.
 *   npx tsx --env-file=.env.local evals/run-classification.ts [--only T05,T07] [--runs 1]
 * Needs GEMINI_API_KEY (and optionally GEMINI_MODEL). Report: evals/report/classification.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classify } from '../lib/classify'
import { DEFAULT_CONFIG } from '../lib/config'
import { callTime, EXPECTED, FIXTURES } from './fixtures'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined }
const only = arg('only')?.split(',')
const runs = Number(arg('runs') ?? 1)

type Row = { id: string; run: number; ok: boolean; got: Record<string, unknown>; want: Record<string, unknown>; problems: string[]; facts?: unknown; error?: string }

async function one(id: string, run: number): Promise<Row> {
  const f = FIXTURES.find((x) => x.id === id)!
  const e = EXPECTED.cases[id]
  const want = { intent: e.intent, outcome: e.outcome, decline_reason: e.decline_reason, ...(e.priority !== undefined ? { priority: e.priority } : {}) }
  try {
    const { facts, decision } = await classify(f.transcript, DEFAULT_CONFIG, callTime(f))
    const got = { intent: decision.intent, outcome: decision.outcome, decline_reason: decision.decline_reason, priority: decision.priority }
    const problems = Object.entries(want).filter(([k, v]) => (got as Record<string, unknown>)[k] !== v).map(([k, v]) => `${k}: expected ${String(v)}, got ${String((got as Record<string, unknown>)[k])}`)
    return { id, run, ok: problems.length === 0, got, want, problems, facts }
  } catch (err) {
    return { id, run, ok: false, got: {}, want, problems: [`error: ${(err as Error).message}`], error: (err as Error).message }
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY is not set'); process.exit(2) }
  const ids = Object.keys(EXPECTED.cases).filter((i) => !only || only.includes(i))
  const jobs = ids.flatMap((id) => Array.from({ length: runs }, (_, r) => ({ id, r })))
  const rows: Row[] = []
  const queue = [...jobs]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) rows.push(await one(j.id, j.r))
  }))
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run)
  console.log(`\nmodel: ${process.env.GEMINI_MODEL ?? 'gemini-3.8-flash (default)'}   min_completion_weeks=${DEFAULT_CONFIG.minCompletionWeeks}\n`)
  for (const r of rows) {
    const g = r.got as { outcome?: string; decline_reason?: string | null; priority?: boolean }
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(5)} ${String(g.outcome ?? '-').padEnd(20)} ${String(g.decline_reason ?? '').padEnd(13)} ${g.priority ? '⭐' : '  '}  ${r.ok ? '' : r.problems.join('; ')}`)
  }
  const failed = rows.filter((r) => !r.ok)
  console.log(`\n${rows.length - failed.length}/${rows.length} passed`)
  for (const r of failed) {
    console.log(`\n--- ${r.id} (${EXPECTED.cases[r.id].why})`)
    if (r.facts) { const x = r.facts as Record<string, unknown>; console.log(JSON.stringify({ intent: x.intent, weeks_until_needed: x.weeks_until_needed, excluded_category: x.excluded_category, segment: x.segment, area: x.carpet_area_sqft, budget: x.volunteered_total_budget_inr, rubric: x.rubric }, null, 1)) }
  }
  mkdirSync(join(__dirname, 'report'), { recursive: true })
  writeFileSync(join(__dirname, 'report', 'classification.json'), JSON.stringify({ model: process.env.GEMINI_MODEL, rows }, null, 1))
  process.exit(failed.length ? 1 : 0)
}
main()
