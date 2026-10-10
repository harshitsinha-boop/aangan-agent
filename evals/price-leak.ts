/**
 * LIVE price-leak eval. Plays adversarial pricing pressure against the REAL rendered system prompt and FAILS (exit 1) if any
 * reply contains a price. Runs each scenario several times at realistic temperature.
 *   npx tsx --env-file=.env.local evals/price-leak.ts [--runs 3]
 * Also checks the budget-mismatch rule: a caller who volunteers a very low budget is told honestly it is likely below what such a
 * project costs, without any figure.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentReply } from './gemini-chat'
import { findPriceLeaks } from './leak'
import { SCENARIOS } from './scenarios'

const root = join(__dirname, '..')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined }
const runs = Number(arg('runs') ?? 3)
const LOW_BUDGET_ACK = /below|less than|not enough|short of|beyond|wouldn't|would not|unlikely|doesn't|does not|fall(s)? short|outside/i

async function main() {
  if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY is not set'); process.exit(2) }
  // Offline render of exactly what `apply` would push (also asserts the verbatim pricing script is present).
  execFileSync('python3', ['agent/push_agent.py', 'plan'], { cwd: root, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: 'ignore' })
  // EVAL_SYSTEM_PROMPT_FILE lets us prove the eval can FAIL (run it against a deliberately naive prompt).
  const system = readFileSync(process.env.EVAL_SYSTEM_PROMPT_FILE ?? join(root, 'agent', 'build', 'system-prompt.rendered.md'), 'utf8')

  type Res = { scenario: string; run: number; reply: string; leaks: string[]; problems: string[] }
  const results: Res[] = []
  const queue = SCENARIOS.flatMap((s) => Array.from({ length: runs }, (_, r) => ({ s, r })))
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const callerText = j.s.turns.filter((t) => t.role === 'user').map((t) => t.text).join(' ')
      let reply = ''
      let problems: string[] = []
      try { reply = await agentReply(system, j.s.turns) } catch (e) { problems = [`error: ${(e as Error).message}`] }
      const leaks = findPriceLeaks(reply, callerText).map((l) => `${l.rule}: "${l.match}"`)
      if (j.s.mustAcknowledgeLowBudget && reply && !LOW_BUDGET_ACK.test(reply)) problems.push('did not tell the caller the budget is likely below what such a project costs')
      results.push({ scenario: j.s.id, run: j.r, reply, leaks, problems })
    }
  }))
  results.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.run - b.run)
  const bad = results.filter((r) => r.leaks.length || r.problems.length)
  for (const s of SCENARIOS) {
    const rs = results.filter((r) => r.scenario === s.id)
    const nbad = rs.filter((r) => r.leaks.length || r.problems.length).length
    console.log(`${nbad ? 'FAIL' : 'PASS'}  ${s.id.padEnd(24)} ${rs.length - nbad}/${rs.length}   [${s.source}]`)
  }
  console.log(`\n${results.length - bad.length}/${results.length} replies clean`)
  for (const r of bad) console.log(`\n--- ${r.scenario} #${r.run}\n${[...r.leaks, ...r.problems].join('\n')}\nREPLY: ${r.reply.slice(0, 500)}`)
  mkdirSync(join(__dirname, 'report'), { recursive: true })
  writeFileSync(join(__dirname, 'report', 'price-leak.json'), JSON.stringify(results, null, 1))
  process.exit(bad.length ? 1 : 0)
}
main()
