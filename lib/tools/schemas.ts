// Single source of truth for tool inputs. The routes validate with these, agent/tools.json is generated to
// match them, and a test fails if the two drift apart.
import { z } from 'zod'

export const LookupCallerBody = z.object({ phone: z.string().min(5), vaani_call_id: z.string().min(1).optional() })

export const AvailabilityBody = z.object({
  visit_type: z.enum(['site', 'studio']).optional(),
  priority: z.boolean().optional(),
  prefer: z.enum(['evening', 'weekend', 'any']).optional(),
  days_ahead: z.number().int().min(1).max(30).optional(),
  limit: z.number().int().min(1).max(8).optional(),
})

export const BookBody = z.object({
  vaani_call_id: z.string().min(1).optional(),
  phone: z.string().min(5),
  slot_id: z.uuid(),
  name: z.string().min(1).max(120).optional(),
  email: z.email().optional(),
  project_type: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  carpet_area_sqft: z.number().int().positive().max(200000).optional(),
  current_state: z.string().max(500).optional(),
  timeline: z.string().max(200).optional(),
  budget_volunteered: z.string().max(200).optional(),
  source_or_referrer: z.string().max(200).optional(),
  priority: z.boolean().optional(),
})

export const EscalateBody = z.object({
  vaani_call_id: z.string().min(1).optional(),
  phone: z.string().min(5),
  name: z.string().min(1).max(120),
  project: z.string().max(300).optional(),
  designer_name: z.string().max(120).optional(),
  issue: z.string().max(600).optional(),
})
