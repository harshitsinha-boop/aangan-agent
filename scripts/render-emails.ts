/** Render every email template with sample data to emails/preview/*.html for visual review. No network, no secrets.
 *   npx tsx scripts/render-emails.ts */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { confirmationEmail, escalationEmail, handoffEmail, reminderEmail, type HandoffData } from '../lib/email/compose'

const lead: HandoffData = {
  name: 'Priya Kulkarni', phone: '+919812345678', location: 'Kothrud, Pune', projectType: '3BHK full redesign', carpetArea: 1400,
  scope: 'Kitchen, living room and both bedrooms; flat is two years old, builder finish', timeline: 'Done by March', budget: null,
  source: 'Referral: Shruti Joshi (past client, Aundh)',
  rubric: [
    { label: 'Real project with execution', status: 'pass' }, { label: 'In service area (Pune / PCMC)', status: 'pass' },
    { label: 'Realistic timeline', status: 'pass' }, { label: 'Budget broadly aligned', status: 'pass', note: 'not mentioned' },
    { label: 'Decision-maker on the call', status: 'unclear', note: 'husband agrees but was not on the call' },
  ],
  uncertainty: 'Spouse is a co-owner and was not on the call; caller says she is authorised to proceed.',
  consultation: { when: 'Sat, 17 Oct, 6:00 pm', visitType: 'site' },
  summary: 'Priya wants the whole 3BHK redone with execution and is in no rush before March. She was referred by a past client and booked a site visit.',
  priority: false, acceptUrl: 'https://aangan-agent.vercel.app/api/actions/EXAMPLE-ACCEPT', reassignUrl: 'https://aangan-agent.vercel.app/api/actions/EXAMPLE-REASSIGN',
  dashboardUrl: 'https://aangan-agent.vercel.app/dashboard/leads/EXAMPLE',
}
const out = join(__dirname, '..', 'emails', 'preview')
mkdirSync(out, { recursive: true })
const write = (name: string, m: { subject: string; html: string }) => { writeFileSync(join(out, `${name}.html`), m.html); console.log(name.padEnd(22), m.subject) }

async function main() {
  write('handoff', await handoffEmail(lead))
  write('handoff-priority', await handoffEmail({ ...lead, priority: true, name: 'Aarti Mehta', location: 'Koregaon Park', projectType: '4BHK full redesign', carpetArea: 2400, uncertainty: null, source: 'Referral: Vikram Agarwal (close friend of Nikhil)' }))
  write('reminder', await reminderEmail({ ...lead, hoursWaiting: 2.3 }))
  write('escalation', await escalationEmail({ name: 'Sheetal Deshpande', project: '2BHK, Viman Nagar (3 months in)', designer: 'Aryan', issue: 'Designer has not replied for five days despite three messages and two calls.', calledAt: 'Wed, 10 Sep, 11:32 am', callbackMinutes: 15, acknowledgeUrl: 'https://aangan-agent.vercel.app/api/actions/EXAMPLE-ACK', dashboardUrl: 'https://aangan-agent.vercel.app/dashboard/escalations' }))
  write('confirmation', await confirmationEmail({ name: 'Priya', when: 'Sat, 17 Oct, 6:00 pm', visitType: 'studio', designerFirstName: 'Aryan', studioAddress: 'Aangan Studio, Pune (address to be confirmed)' }))
}
main()
