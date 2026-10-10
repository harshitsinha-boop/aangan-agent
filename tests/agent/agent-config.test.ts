import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { AvailabilityBody, BookBody, EscalateBody, LookupCallerBody } from '@/lib/tools/schemas'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const offlineEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } // plan must never hit the network in tests

const PRICING_SCRIPT =
  "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."

// Distinctive values/phrases from the internal pricing guide. None may ever reach the agent.
const PRICING_LEAKS = [/1,?800/, /2,?400\b(?!\s*(sq|square))/, /3,?500/, /1,?200/, /2,?800/, /4,?000/, /8\s*lakh/i, /3\.5\s*lakh/i,
  /per sq\.? ?ft/i, /₹/, /indicative range/i, /standard specification/i, /luxury specification/i, /premium specification/i]

let prompt: string
let persona: { identity: { greeting_message: { agent_message: string } }; actions: { functions: { name: string; curl: string }[] } }

beforeAll(() => {
  // `plan` is offline and needs no secrets: it renders exactly what `apply` would push.
  execFileSync('python3', ['agent/push_agent.py', 'plan'], { cwd: root, env: offlineEnv })
  prompt = read('agent/build/system-prompt.rendered.md')
  persona = JSON.parse(read('agent/build/persona.json'))
})

describe('rendered system prompt', () => {
  it('contains the pricing script word for word', () => expect(prompt).toContain(PRICING_SCRIPT))
  it('has no unfilled placeholders', () => expect(prompt).not.toMatch(/\[\[[A-Z_]+\]\]/))
  it('holds no pricing-guide figure or phrase', () => {
    for (const re of PRICING_LEAKS) expect(prompt, String(re)).not.toMatch(re)
  })
  it('mentions "lakh" only inside the single internal budget rule', () => {
    const hits = prompt.split('\n').filter((l) => /\blakh\b/i.test(l))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatch(/volunteer|on their own/i)
    expect(hits[0]).toMatch(/never say/i)
  })
  it('tells the agent never to probe for budget and never to state a figure', () => {
    expect(prompt).toMatch(/Never ask a caller about their budget/)
    expect(prompt).toMatch(/NEVER say any price/)
  })
  it('covers every routing path and tool', () => {
    for (const s of ['Path A', 'Path B', 'lookup_caller', 'get_availability', 'book_consultation', 'escalate', 'within 15 minutes', 'priority'])
      expect(prompt).toContain(s)
  })
  it('is a sensible size for a voice prompt', () => expect(prompt.length).toBeLessThan(24_000))
})

describe('knowledge base text', () => {
  for (const f of ['agent/knowledge/services.md', 'agent/knowledge/qualified.md']) {
    it(`${f} has no currency, rate or pricing-guide content`, () => {
      const t = read(f)
      for (const re of PRICING_LEAKS) expect(t, String(re)).not.toMatch(re)
      expect(t).not.toMatch(/\blakh\b|\bcrore\b/i)
    })
  }
  it('is built from services.md + qualified.md only (never pricing.md)', () => {
    expect(read('agent/knowledge_build.py')).not.toMatch(/pricing\.md['"]\)/)
  })
  it('timeline conflict is resolved through the config placeholder, not two competing numbers', () => {
    expect(read('agent/knowledge/services.md')).toContain('[[MIN_COMPLETION_WEEKS]]')
    expect(read('agent/knowledge/qualified.md')).toContain('[[MIN_COMPLETION_WEEKS]]')
    expect(read('agent/knowledge/services.md')).not.toMatch(/under 6 weeks/)
  })
})

describe('disclosure and language', () => {
  it('greeting says it is Aangan\'s AI assistant and that the call is recorded', () => {
    const g = persona.identity.greeting_message.agent_message
    expect(g).toMatch(/AI assistant/)
    expect(g).toMatch(/recorded/)
  })
  it('prompt requires English/Hindi/Marathi matching', () => expect(prompt).toMatch(/English, Hindi or Marathi/))
})

describe('tools.json matches the API routes', () => {
  const tools = JSON.parse(read('agent/tools.json')).tools as { name: string; path: string; parameters: { properties: Record<string, unknown>; required: string[] } }[]
  const schemas = { lookup_caller: LookupCallerBody, get_availability: AvailabilityBody, book_consultation: BookBody, escalate: EscalateBody } as const
  const paths = { lookup_caller: '/api/tools/lookup-caller', get_availability: '/api/tools/availability', book_consultation: '/api/tools/book', escalate: '/api/tools/escalate' }

  it('defines exactly the four tools', () => expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(schemas).sort()))
  for (const t of tools) {
    it(`${t.name}: same parameters and required-ness as the zod schema`, () => {
      const schema = schemas[t.name as keyof typeof schemas]
      const shape = schema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>
      expect(Object.keys(t.parameters.properties).sort()).toEqual(Object.keys(shape).sort())
      const required = Object.keys(shape).filter((k) => !shape[k].safeParse(undefined).success).sort()
      expect([...t.parameters.required].sort()).toEqual(required)
      expect(t.path).toBe(paths[t.name as keyof typeof paths])
    })
  }
})

describe('push script safety', () => {
  it('refuses to apply without --yes', () => {
    const r = spawnSync('python3', ['agent/push_agent.py', 'apply', '--agent-id', 'x'], { cwd: root, encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/--yes/)
  })
  it('does not write the tool secret into the offline plan output', () => {
    const secret = 'super-secret-value-that-must-not-leak'
    execFileSync('python3', ['agent/push_agent.py', 'plan'], { cwd: root, env: { ...offlineEnv, VAANI_TOOL_SECRET: secret } })
    expect(read('agent/build/persona.json')).not.toContain(secret)
    expect(persona.actions.functions[0].curl).toContain('<VAANI_TOOL_SECRET>')
  })
})
