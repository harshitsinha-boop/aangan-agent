// Plain-HTML message composers. Phase 4 swaps the bodies for React Email templates; signatures and the
// privacy rules stay: summary + dashboard link only, never the transcript, phone shown as last 4 digits.
import { phoneLast4 } from '@/lib/phone'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type RubricLine = { label: string; status: 'pass' | 'unclear' | 'fail'; note?: string | null }

export type HandoffData = {
  name: string | null
  phone: string | null
  location: string | null
  projectType: string | null
  carpetArea: number | null
  scope: string | null
  timeline: string | null
  budget: string | null
  source: string | null
  rubric: RubricLine[]
  uncertainty: string | null
  consultation: { when: string; visitType: string } | null
  summary: string
  priority: boolean
  acceptUrl: string
  reassignUrl: string
  dashboardUrl: string
}

const row = (k: string, v: unknown) => (v ? `<tr><td style="padding:2px 12px 2px 0;color:#666">${esc(k)}</td><td>${esc(v)}</td></tr>` : '')
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:10px 18px;border-radius:8px;background:#7a4a2b;color:#fff;text-decoration:none">${esc(label)}</a>`

export function handoffEmail(d: HandoffData) {
  const subject = `${d.priority ? '⭐ Priority: ' : ''}New lead: ${d.name ?? 'Unknown'} · ${d.location ?? 'Location TBC'} · ${d.projectType ?? 'Project TBC'}`
  const checks = d.rubric.map((r) => `${r.status === 'pass' ? '✅' : '⚠️'} ${r.label}${r.note ? ` — ${r.note}` : ''}`)
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
<h2 style="margin:0 0 8px">${esc(subject)}</h2>
<table>${row('Name', d.name)}${row('Phone', phoneLast4(d.phone))}${row('Location', d.location)}${row('Project', d.projectType)}${row('Carpet area', d.carpetArea ? `${d.carpetArea} sq ft` : null)}${row('Scope / current state', d.scope)}${row('Timeline', d.timeline)}${row('Budget (volunteered)', d.budget)}${row('Source / referrer', d.source)}${row('Consultation', d.consultation ? `${d.consultation.when} · ${d.consultation.visitType} visit` : 'Not booked yet')}</table>
<h3>Rubric</h3><ul>${checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
${d.uncertainty ? `<p><b>Uncertainty:</b> ${esc(d.uncertainty)}</p>` : ''}
<p>${esc(d.summary)}</p>
<p>${button(d.acceptUrl, 'Accept')}${button(d.reassignUrl, 'Reassign')}${button(d.dashboardUrl, 'Open in dashboard')}</p></div>`
  const text = [subject, '', `Phone: ${phoneLast4(d.phone)}`, ...checks, d.uncertainty ?? '', d.summary, '',
    `Accept: ${d.acceptUrl}`, `Reassign: ${d.reassignUrl}`, `Dashboard: ${d.dashboardUrl}`].join('\n')
  return { subject, html, text }
}

export type EscalationData = {
  name: string | null
  project: string | null
  designer: string | null
  issue: string | null
  calledAt: string
  callbackMinutes: number
  acknowledgeUrl: string
  dashboardUrl: string
}

export function escalationEmail(d: EscalationData) {
  const subject = `URGENT: Existing client · ${d.name ?? 'Unknown'} · callback within ${d.callbackMinutes} min`
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
<h2 style="margin:0 0 8px;color:#b3261e">${esc(subject)}</h2>
<table>${row('Client', d.name)}${row('Project', d.project)}${row('Designer', d.designer)}${row('Issue', d.issue)}${row('Called at', d.calledAt)}</table>
<p>${button(d.acknowledgeUrl, 'Acknowledge — I will call back')}</p>
<p style="color:#666">Clicking records you as the owner. <a href="${esc(d.dashboardUrl)}">Open in dashboard</a></p></div>`
  const text = [subject, '', `Client: ${d.name}`, `Project: ${d.project}`, `Designer: ${d.designer}`, `Issue: ${d.issue}`,
    `Called at: ${d.calledAt}`, '', `Acknowledge: ${d.acknowledgeUrl}`].join('\n')
  return { subject, html, text }
}

export type ConfirmationData = {
  name: string | null
  when: string
  visitType: 'site' | 'studio'
  designerFirstName: string
  studioAddress: string
}

export function confirmationEmail(d: ConfirmationData) {
  const subject = 'Your Aangan Studio consultation is booked'
  const where = d.visitType === 'site'
    ? `${esc(d.designerFirstName)} will visit your site. We will confirm the exact address with you before the visit.`
    : `Please visit us at ${esc(d.studioAddress)}.`
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2>Hello${d.name ? ` ${esc(d.name)}` : ''},</h2>
<p>Your consultation is confirmed.</p>
<table>${row('When', d.when)}${row('Type', d.visitType === 'site' ? 'Site visit' : 'Studio visit')}${row('Designer', d.designerFirstName)}</table>
<p>${where}</p><p>Warm regards,<br>Aangan Studio</p></div>`
  const text = `Your consultation is confirmed.\nWhen: ${d.when}\nType: ${d.visitType} visit\nDesigner: ${d.designerFirstName}\n${where.replace(/<[^>]+>/g, '')}`
  return { subject, html, text }
}

export function reminderEmail(d: HandoffData & { hoursWaiting: number }) {
  const base = handoffEmail(d)
  const subject = `Reminder: ${base.subject}`
  const banner = `<p style="background:#fff4e5;padding:8px 12px;border-radius:6px">This lead has waited ${Math.round(d.hoursWaiting * 10) / 10}h without being accepted. If nobody accepts it soon, it will be reassigned to the principal designer.</p>`
  return { subject, html: banner + base.html, text: `Waiting ${Math.round(d.hoursWaiting)}h, not accepted yet.\n\n${base.text}` }
}
