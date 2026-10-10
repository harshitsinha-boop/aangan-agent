import { Resend } from 'resend'
import { env } from '@/lib/env'

export type Mail = {
  to: string
  subject: string
  html: string
  text: string
  urgent?: boolean
  tags?: Record<string, string>
}
export interface Mailer {
  send(m: Mail): Promise<{ id: string | null }>
}

class ResendMailer implements Mailer {
  async send(m: Mail) {
    const e = env()
    if (!e.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
    // Test phase: redirect everything to one inbox; keep the real recipient visible in the subject.
    const to = e.EMAIL_TEST_REDIRECT ?? m.to
    const subject = e.EMAIL_TEST_REDIRECT && e.EMAIL_TEST_REDIRECT !== m.to ? `[to: ${m.to}] ${m.subject}` : m.subject
    const { data, error } = await new Resend(e.RESEND_API_KEY).emails.send({
      from: e.EMAIL_FROM,
      to,
      subject,
      html: m.html,
      text: m.text,
      headers: m.urgent ? { 'X-Priority': '1', Importance: 'high' } : undefined,
      tags: m.tags ? Object.entries(m.tags).map(([name, value]) => ({ name, value })) : undefined,
    })
    if (error) throw new Error(`Resend: ${error.message}`)
    return { id: data?.id ?? null }
  }
}

let mailer: Mailer | undefined
export const getMailer = (): Mailer => (mailer ??= new ResendMailer())
/** For tests. */
export const setMailer = (m: Mailer | undefined) => { mailer = m }
