import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  ACTION_TOKEN_SECRET: z.string().min(16),
  CRON_SECRET: z.string().min(16),
  VAANI_TOOL_SECRET: z.string().min(16),
  VAANI_WEBHOOK_SECRET: z.string().min(16),
  VAANI_API_KEY: z.string().optional(),
  VAANI_AGENT_ID: z.string().optional(),
  VAANI_ALERT_AGENT_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default('Aangan Studio <onboarding@resend.dev>'),
  // Test phase: every outgoing email is redirected here (Resend's test sender only delivers to the account owner).
  EMAIL_TEST_REDIRECT: z.email().optional(),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
})

export type Env = z.infer<typeof schema>
let cached: Env | undefined

/** Validated lazily so `next build` does not need production secrets. */
export function env(): Env {
  if (!cached) {
    const r = schema.safeParse(process.env)
    if (!r.success) {
      const bad = r.error.issues.map((i) => i.path.join('.')).join(', ')
      throw new Error(`Invalid or missing environment variables: ${bad}`)
    }
    cached = r.data
  }
  return cached
}
export const resetEnvCache = () => { cached = undefined }
