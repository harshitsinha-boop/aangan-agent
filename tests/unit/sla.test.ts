import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@/lib/config'
import { decideHandoffAction, escalationDue, fallbackMetadata } from '@/lib/sla'

const cfg = DEFAULT_CONFIG // ack 5 min, accept 2 h, hours 10:00-19:00 IST
const ist = (s: string) => new Date(`${s}+05:30`)
const h = (sent: string, over: Partial<{ reminder_sent_at: string | null; ownerIsPrincipal: boolean }> = {}) =>
  ({ sent_at: ist(sent).toISOString(), reminder_sent_at: null, ownerIsPrincipal: false, ...over })

describe('escalation fallback timing (escalation_ack_minutes = 5)', () => {
  const sent = ist('2026-10-10T23:00:00').toISOString()
  it('is not due before the threshold, due at it (any time of day: escalations ignore business hours)', () => {
    expect(escalationDue({ sent_at: sent, acknowledged_at: null, fallback_call_at: null }, cfg, ist('2026-10-10T23:04:59'))).toBe(false)
    expect(escalationDue({ sent_at: sent, acknowledged_at: null, fallback_call_at: null }, cfg, ist('2026-10-10T23:05:00'))).toBe(true)
  })
  it('never fires once acknowledged or already called', () => {
    const later = ist('2026-10-10T23:30:00')
    expect(escalationDue({ sent_at: sent, acknowledged_at: '2026-10-10T17:33:00Z', fallback_call_at: null }, cfg, later)).toBe(false)
    expect(escalationDue({ sent_at: sent, acknowledged_at: null, fallback_call_at: '2026-10-10T17:36:00Z' }, cfg, later)).toBe(false)
  })
  it('honours a changed threshold from config', () => {
    const c = { ...cfg, escalationAckMinutes: 1 }
    expect(escalationDue({ sent_at: sent, acknowledged_at: null, fallback_call_at: null }, c, ist('2026-10-10T23:01:00'))).toBe(true)
  })
  it('reads out the caller name and issue to the studio head, with safe wording when fields are missing', () => {
    expect(fallbackMetadata({ client_name: 'Sheetal Deshpande', project: '2BHK Viman Nagar', issue_summary: 'No reply in five days' }, cfg))
      .toEqual({ client_name: 'Sheetal Deshpande', project: '2BHK Viman Nagar', issue: 'No reply in five days', callback_minutes: 15 })
    expect(fallbackMetadata({ client_name: null, project: null, issue_summary: null }, cfg).client_name).toBe('an existing client')
  })
})

describe('handoff SLA (handoff_accept_hours = 2, business hours only)', () => {
  it('does nothing before 2 business hours', () =>
    expect(decideHandoffAction(h('2026-10-12T11:00:00'), cfg, ist('2026-10-12T12:59:00')).action).toBe('none'))
  it('sends the reminder at 2 business hours', () =>
    expect(decideHandoffAction(h('2026-10-12T11:00:00'), cfg, ist('2026-10-12T13:00:00')).action).toBe('remind'))
  it('does not remind twice', () =>
    expect(decideHandoffAction(h('2026-10-12T11:00:00', { reminder_sent_at: '2026-10-12T07:30:00Z' }), cfg, ist('2026-10-12T14:00:00')).action).toBe('none'))
  it('reassigns at the next threshold (4 business hours)', () => {
    const r = decideHandoffAction(h('2026-10-12T11:00:00', { reminder_sent_at: '2026-10-12T07:30:00Z' }), cfg, ist('2026-10-12T15:00:00'))
    expect(r.action).toBe('reassign'); expect(r.waitedMinutes).toBe(240)
  })
  it('reassigns even if the reminder was skipped (e.g. cron was down)', () =>
    expect(decideHandoffAction(h('2026-10-12T11:00:00'), cfg, ist('2026-10-12T16:00:00')).action).toBe('reassign'))
  it('never reassigns a handoff the principal already owns', () =>
    expect(decideHandoffAction(h('2026-10-12T11:00:00', { ownerIsPrincipal: true }), cfg, ist('2026-10-12T18:00:00')).action).toBe('remind'))
  it('a lead that arrived after hours starts its clock when the studio opens', () => {
    // sent 22:00; at 10:00 next day zero business minutes have elapsed; at 12:00 two hours have
    expect(decideHandoffAction(h('2026-10-12T22:00:00'), cfg, ist('2026-10-13T10:00:00')).action).toBe('none')
    expect(decideHandoffAction(h('2026-10-12T22:00:00'), cfg, ist('2026-10-13T11:59:00')).action).toBe('none')
    expect(decideHandoffAction(h('2026-10-12T22:00:00'), cfg, ist('2026-10-13T12:00:00')).action).toBe('remind')
  })
  it('nothing fires overnight for a lead sent late in the day', () => {
    // sent 18:30 -> 30 min counted that evening; overnight adds nothing
    expect(decideHandoffAction(h('2026-10-12T18:30:00'), cfg, ist('2026-10-13T09:30:00')).waitedMinutes).toBe(30)
    expect(decideHandoffAction(h('2026-10-12T18:30:00'), cfg, ist('2026-10-13T09:30:00')).action).toBe('none')
  })
  it('thresholds follow config', () => {
    const c = { ...cfg, handoffAcceptHours: 1 }
    expect(decideHandoffAction(h('2026-10-12T11:00:00'), c, ist('2026-10-12T12:00:00')).action).toBe('remind')
    expect(decideHandoffAction(h('2026-10-12T11:00:00'), c, ist('2026-10-12T13:00:00')).action).toBe('reassign')
  })
})
