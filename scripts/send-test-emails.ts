/**
 * Sends one of each template through the real Resend integration to EMAIL_TEST_REDIRECT.
 *   npx tsx --env-file=.env.local scripts/send-test-emails.ts
 * Needs RESEND_API_KEY and EMAIL_TEST_REDIRECT (your own Resend account email while on the test sender).
 * Links in these samples are placeholders; real action links are minted per email by lib/notify.ts.
 */
import { confirmationEmail, escalationEmail, handoffEmail, reminderEmail, type HandoffData } from '../lib/email/compose'
import { getMailer } from '../lib/mail'

const redirect = process.env.EMAIL_TEST_REDIRECT
if (!redirect || !process.env.RESEND_API_KEY) { console.error('Set RESEND_API_KEY and EMAIL_TEST_REDIRECT in .env.local'); process.exit(1) }
const to: string = redirect
const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const lead: HandoffData = {
  name: 'Test Lead', phone: '+919000000000', location: 'Baner', projectType: '2BHK full redesign', carpetArea: 950, scope: 'Kitchen, wardrobes, living, 2 bedrooms',
  timeline: 'Move in by November', budget: null, source: 'Instagram',
  rubric: [{ label: 'Real project with execution', status: 'pass' }, { label: 'Decision-maker on the call', status: 'pass' }],
  uncertainty: null, consultation: { when: 'Sat, 17 Oct, 6:00 pm', visitType: 'site' }, summary: 'Sample message from scripts/send-test-emails.ts.',
  priority: false, acceptUrl: `${base}/api/actions/SAMPLE`, reassignUrl: `${base}/api/actions/SAMPLE`, dashboardUrl: `${base}/dashboard`,
}

async function main() {
  const mailer = getMailer()
  const msgs = [
    { kind: 'handoff', ...(await handoffEmail(lead)) },
    { kind: 'handoff_reminder', ...(await reminderEmail({ ...lead, hoursWaiting: 2.1 })) },
    { kind: 'escalation', ...(await escalationEmail({ name: 'Test Client', project: '2BHK, Baner', designer: 'Aryan', issue: 'Sample escalation', calledAt: 'now', callbackMinutes: 15, acknowledgeUrl: `${base}/api/actions/SAMPLE`, dashboardUrl: `${base}/dashboard` })) },
    { kind: 'confirmation', ...(await confirmationEmail({ name: 'Test', when: 'Sat, 17 Oct, 6:00 pm', visitType: 'studio', designerFirstName: 'Aryan', studioAddress: 'Aangan Studio, Pune' })) },
  ]
  for (const m of msgs) {
    const r = await mailer.send({ to, subject: m.subject, html: m.html, text: m.text, urgent: m.kind === 'escalation', tags: { kind: `test_${m.kind}` } })
    console.log('sent', m.kind, r.id)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
