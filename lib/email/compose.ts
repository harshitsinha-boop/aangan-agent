// Renders the React Email templates in /emails. Privacy rules live in the templates and are tested in
// tests/unit/emails.test.ts: a summary and a dashboard link only, never the transcript, phone as last 4 digits.
import { render } from '@react-email/render'
import ConfirmationEmail, { confirmationSubject } from '@/emails/ConfirmationEmail'
import EscalationEmail, { escalationSubject } from '@/emails/EscalationEmail'
import HandoffEmail, { handoffSubject } from '@/emails/HandoffEmail'
import type { ConfirmationData, EscalationData, HandoffData, ReminderData } from '@/emails/types'

export type { ConfirmationData, EscalationData, HandoffData, ReminderData, RubricLine } from '@/emails/types'
export type Rendered = { subject: string; html: string; text: string }

const both = async (el: React.ReactElement) => ({ html: await render(el), text: await render(el, { plainText: true }) })

export async function handoffEmail(d: HandoffData): Promise<Rendered> {
  return { subject: handoffSubject(d), ...(await both(HandoffEmail(d))) }
}

export async function reminderEmail(d: ReminderData): Promise<Rendered> {
  const { hoursWaiting, ...rest } = d
  return { subject: `Reminder: ${handoffSubject(d)}`, ...(await both(HandoffEmail({ ...rest, reminderHours: hoursWaiting }))) }
}

export async function escalationEmail(d: EscalationData): Promise<Rendered> {
  return { subject: escalationSubject(d), ...(await both(EscalationEmail(d))) }
}

export async function confirmationEmail(d: ConfirmationData): Promise<Rendered> {
  return { subject: confirmationSubject, ...(await both(ConfirmationEmail(d))) }
}
