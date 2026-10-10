import type { Db } from '@/lib/supabase/admin'
import { must } from '@/lib/supabase/admin'

export type BusinessHours = { start: string; end: string; tz: string }
export type AppConfig = {
  minCompletionWeeks: number
  commercialMinSqft: number
  commercialMaxSqft: number
  businessHours: BusinessHours
  answerMode: 'all_calls' | 'after_hours_and_overflow'
  escalationAckMinutes: number
  handoffAcceptHours: number
  budgetFloorInr: number
  largeResidentialSqft: number
  escalationTokenHours: number
  handoffTokenHours: number
  escalationCallbackMinutes: number
  studioAddress: string
}

export const DEFAULT_CONFIG: AppConfig = {
  minCompletionWeeks: 8,
  commercialMinSqft: 500,
  commercialMaxSqft: 3000,
  businessHours: { start: '10:00', end: '19:00', tz: 'Asia/Kolkata' },
  answerMode: 'all_calls',
  escalationAckMinutes: 5,
  handoffAcceptHours: 2,
  budgetFloorInr: 300000,
  largeResidentialSqft: 3000,
  escalationTokenHours: 2,
  handoffTokenHours: 72,
  escalationCallbackMinutes: 15,
  studioAddress: 'Aangan Studio, Pune (address to be confirmed)',
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)

export function parseConfig(rows: { key: string; value: unknown }[]): AppConfig {
  const m = new Map(rows.map((r) => [r.key, r.value]))
  const d = DEFAULT_CONFIG
  const bh = m.get('business_hours') as Partial<BusinessHours> | undefined
  const mode = m.get('answer_mode')
  return {
    minCompletionWeeks: num(m.get('min_completion_weeks'), d.minCompletionWeeks),
    commercialMinSqft: num(m.get('commercial_min_sqft'), d.commercialMinSqft),
    commercialMaxSqft: num(m.get('commercial_max_sqft'), d.commercialMaxSqft),
    businessHours: {
      start: typeof bh?.start === 'string' ? bh.start : d.businessHours.start,
      end: typeof bh?.end === 'string' ? bh.end : d.businessHours.end,
      tz: typeof bh?.tz === 'string' ? bh.tz : d.businessHours.tz,
    },
    answerMode: mode === 'after_hours_and_overflow' ? mode : 'all_calls',
    escalationAckMinutes: num(m.get('escalation_ack_minutes'), d.escalationAckMinutes),
    handoffAcceptHours: num(m.get('handoff_accept_hours'), d.handoffAcceptHours),
    budgetFloorInr: num(m.get('budget_floor_inr'), d.budgetFloorInr),
    largeResidentialSqft: num(m.get('large_residential_sqft'), d.largeResidentialSqft),
    escalationTokenHours: num(m.get('escalation_token_hours'), d.escalationTokenHours),
    handoffTokenHours: num(m.get('handoff_token_hours'), d.handoffTokenHours),
    escalationCallbackMinutes: num(m.get('escalation_callback_minutes'), d.escalationCallbackMinutes),
    studioAddress: typeof m.get('studio_address') === 'string' ? (m.get('studio_address') as string) : d.studioAddress,
  }
}

export async function loadConfig(db: Db): Promise<AppConfig> {
  return parseConfig(must(await db.from('config').select('key,value'), 'load config'))
}
