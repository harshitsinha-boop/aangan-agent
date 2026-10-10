import { describe, expect, it } from 'vitest'
import { decide } from '@/lib/classify'
import { DEFAULT_CONFIG } from '@/lib/config'
import { handoffEmail, reminderEmail, type HandoffData } from '@/lib/email/compose'
import { isBusinessHours } from '@/lib/hours'
import { callTime, EXPECTED, FIXTURES, MISSED } from '@/evals/fixtures'
import { GOLDEN } from '@/evals/golden'

const ids = Object.keys(EXPECTED.cases)

describe('eval set matches the brief', () => {
  const by = (pred: (e: (typeof EXPECTED.cases)[string]) => boolean) => ids.filter((i) => pred(EXPECTED.cases[i])).sort()
  it('qualified', () => expect(by((e) => e.outcome === 'qualified')).toEqual(['T01', 'T02', 'T05', 'T06', 'T11', 'T12', 'T13', 'T15', 'T16', 'T17b', 'T20']))
  it('qualified with note', () => expect(by((e) => e.outcome === 'qualified_with_note')).toEqual(['T14']))
  it('declined, with the right reason', () => {
    expect(by((e) => e.outcome === 'declined')).toEqual(['T03', 'T04', 'T07', 'T10', 'T18', 'T19'])
    expect(Object.fromEntries(by((e) => e.outcome === 'declined').map((i) => [i, EXPECTED.cases[i].decline_reason])))
      .toEqual({ T03: 'area', T04: 'advice_only', T07: 'timeline', T10: 'budget', T18: 'too_small', T19: 'out_of_scope' })
  })
  it('escalated', () => expect(by((e) => e.outcome === 'escalated')).toEqual(['T09']))
  it('T08 is a missed call, not a classifier case', () => {
    expect(MISSED.map((m) => m.id)).toEqual(['T08'])
    expect(EXPECTED.cases.T08).toBeUndefined()
  })
  it('every expected case has a transcript fixture and a golden extraction, and nothing else does', () => {
    expect(FIXTURES.map((f) => f.id).sort()).toEqual(ids.sort())
    expect(Object.keys(GOLDEN).sort()).toEqual(ids.sort())
  })
})

describe('fixtures are clean inputs', () => {
  it('are in Vaani transcript format and do not contain the staff notes that state the answer', () => {
    for (const f of FIXTURES) {
      expect(f.transcript, f.id).toMatch(/^AGENT: /)
      expect(f.transcript.length, f.id).toBeGreaterThan(40)
      expect(f.transcript, f.id).not.toMatch(/Front Desk:|Caller:|Escalated to studio head|Second call/)
      if (f.staffNote) expect(f.transcript.includes(f.staffNote), f.id).toBe(false)
    }
  })
})

describe('decision rules on perfect extractions (no LLM)', () => {
  for (const id of ids) {
    const e = EXPECTED.cases[id]
    it(`${id}: ${e.outcome}${e.decline_reason ? ` (${e.decline_reason})` : ''}`, () => {
      const d = decide(GOLDEN[id], DEFAULT_CONFIG)
      expect(d.intent).toBe(e.intent)
      expect(d.outcome).toBe(e.outcome)
      expect(d.decline_reason).toBe(e.decline_reason)
      if (e.priority !== undefined) expect(d.priority, 'priority').toBe(e.priority)
    })
  }

  it('the unresolved timeline rule is config-driven: at 10 weeks T02 (move-in ~9 weeks) is declined, at 6 it is fine', () => {
    expect(decide(GOLDEN.T02, { ...DEFAULT_CONFIG, minCompletionWeeks: 10 }).decline_reason).toBe('timeline')
    expect(decide(GOLDEN.T02, { ...DEFAULT_CONFIG, minCompletionWeeks: 6 }).outcome).toBe('qualified')
  })
  it('T18 flips with commercial_min_sqft (the unwritten 500 sq ft rule)', () =>
    expect(decide(GOLDEN.T18, { ...DEFAULT_CONFIG, commercialMinSqft: 150 }).outcome).toBe('qualified'))
  it('T14 keeps its uncertainty note for the designer', () => expect(decide(GOLDEN.T14, DEFAULT_CONFIG).uncertainty_notes).toMatch(/parents/))
})

describe('after-hours path (T08, the missed call at 10:47 pm)', () => {
  const t08 = MISSED[0]
  it('is outside business hours, so the agent must answer it in all_calls mode', () => {
    const when = callTime(t08)
    expect(t08.time).toBe('22:47')
    expect(isBusinessHours(when, DEFAULT_CONFIG.businessHours)).toBe(false)
    expect(DEFAULT_CONFIG.answerMode).toBe('all_calls')
  })
  it('exactly three of the 20 September calls fell outside 10:00-19:00 IST (two early mornings plus T08): the volume this system exists to catch', () => {
    const after = FIXTURES.filter((f) => !isBusinessHours(callTime(f), DEFAULT_CONFIG.businessHours)).map((f) => `${f.id}@${f.time}`)
    expect(after).toEqual(['T07@09:44', 'T20@09:15'])
  })
})

describe('every handoff email built from the eval set leaks neither transcript nor full phone number', () => {
  const sentences = (t: string) => t.split(/(?<=[.?!])\s+|\n+/).map((s) => s.replace(/^(AGENT|USER): /, '').trim()).filter((s) => s.length >= 28)
  for (const f of FIXTURES.filter((x) => ['qualified', 'qualified_with_note'].includes(EXPECTED.cases[x.id].outcome))) {
    it(`${f.id}`, async () => {
      const g = GOLDEN[f.id]
      const phone = `+9198${f.id.replace(/\D/g, '').padStart(2, '0')}1${(callTime(f).getTime() % 1e7).toString().padStart(7, '0')}`.slice(0, 13)
      const d = decide(g, DEFAULT_CONFIG)
      const data: HandoffData = {
        name: g.caller_name, phone, location: g.location, projectType: g.project_type, carpetArea: g.carpet_area_sqft, scope: g.current_state, timeline: g.timeline_text,
        budget: g.budget_text, source: g.source_or_referrer, rubric: Object.entries(d.rubric).map(([k, v]) => ({ label: k, status: v.status, note: v.note })),
        uncertainty: d.uncertainty_notes, consultation: { when: 'Sat 17 Oct, 6:00 pm', visitType: 'site' },
        summary: g.summary || 'Short call summary.', priority: d.priority, acceptUrl: 'https://a.test/api/actions/A', reassignUrl: 'https://a.test/api/actions/R', dashboardUrl: 'https://a.test/dashboard/leads/1',
      }
      for (const m of [await handoffEmail(data), await reminderEmail({ ...data, hoursWaiting: 2 })]) {
        for (const body of [m.html, m.text]) {
          expect(body).not.toContain(phone); expect(body).not.toContain(phone.slice(3)); expect(body).not.toContain('+91')
          expect(body).toContain(phone.slice(-4))
          for (const s of sentences(f.transcript)) expect(body, `transcript sentence leaked: ${s}`).not.toContain(s)
        }
      }
    })
  }
})
