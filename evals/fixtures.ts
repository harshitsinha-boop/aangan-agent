import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Fixture = { id: string; date: string; time: string; transcript: string; staffNote: string | null }
export type Expected = { intent: string; outcome: string; decline_reason: string | null; priority?: boolean; why: string }

const here = __dirname
const raw = JSON.parse(readFileSync(join(here, 'fixtures', 'phone.json'), 'utf8')) as {
  id: string; date: string; time: string; transcript: string | null; staffNote: string | null
  parts?: Record<string, { time: string; transcript: string }>
}[]
export const EXPECTED = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8')) as { cases: Record<string, Expected>; missed: Record<string, { why: string }> }

/** Phone fixtures with a transcript (T08 is a missed call and T17 is split into its two separate calls). */
export const FIXTURES: Fixture[] = raw.flatMap((f) =>
  f.parts
    ? Object.entries(f.parts).map(([id, p]) => ({ id, date: f.date, time: p.time, transcript: p.transcript, staffNote: f.staffNote }))
    : f.transcript ? [{ id: f.id, date: f.date, time: f.time, transcript: f.transcript, staffNote: f.staffNote }] : [],
)
export const MISSED = raw.filter((f) => !f.transcript && !f.parts)

/** The instant a call happened (IST). */
export const callTime = (f: { date: string; time: string }) => new Date(`${f.date}T${f.time}:00+05:30`)
