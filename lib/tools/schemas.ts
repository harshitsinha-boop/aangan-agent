// Single source of truth for tool inputs. The routes validate with these, agent/tools.json is generated to
// match them, and a test fails if the two drift apart.
import { z } from 'zod'

// LLM tool calls often send numbers and booleans as text ("1400", "false"). Accept both.
const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
const posInt = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Math.round(Number(v)) : v), z.number().int().positive().max(max))

export const LookupCallerBody = z.object({ phone: z.string().min(5), vaani_call_id: z.string().min(1).optional() })

export const AvailabilityBody = z.object({
  visit_type: z.enum(['site', 'studio']).optional(),
  priority: bool.optional(),
  prefer: z.enum(['evening', 'weekend', 'any']).optional(),
  days_ahead: posInt(30).optional(),
  limit: posInt(8).optional(),
})

export const BookBody = z.object({
  vaani_call_id: z.string().min(1).optional(),
  phone: z.string().min(5),
  slot_id: z.uuid(),
  name: z.string().min(1).max(120).optional(),
  email: z.email().optional(),
  project_type: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  carpet_area_sqft: posInt(200000).optional(),
  current_state: z.string().max(500).optional(),
  timeline: z.string().max(200).optional(),
  budget_volunteered: z.string().max(200).optional(),
  source_or_referrer: z.string().max(200).optional(),
  priority: bool.optional(),
})

export const EscalateBody = z.object({
  vaani_call_id: z.string().min(1).optional(),
  phone: z.string().min(5),
  name: z.string().min(1).max(120),
  project: z.string().max(300).optional(),
  designer_name: z.string().max(120).optional(),
  issue: z.string().max(600).optional(),
})
