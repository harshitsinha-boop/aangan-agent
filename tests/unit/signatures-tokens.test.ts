import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySvixSignature, verifyVaaniSignature } from '@/lib/signatures'
import { actionUrl, hashToken } from '@/lib/tokens'

const now = 1_800_000_000

describe('Vaani signature', () => {
  const secret = 's3cret'
  const body = '{"event":"call_postprocessing"}'
  const sign = (ts: string, b = body) => 'sha256=' + createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex')
  it('accepts a valid signature', () => expect(verifyVaaniSignature(body, sign(String(now)), String(now), secret, now)).toBe(true))
  it('rejects tampered body, wrong secret, missing headers', () => {
    expect(verifyVaaniSignature(body + ' ', sign(String(now)), String(now), secret, now)).toBe(false)
    expect(verifyVaaniSignature(body, sign(String(now)), String(now), 'other', now)).toBe(false)
    expect(verifyVaaniSignature(body, null, String(now), secret, now)).toBe(false)
  })
  it('rejects replays older than 5 minutes', () =>
    expect(verifyVaaniSignature(body, sign(String(now - 301)), String(now - 301), secret, now)).toBe(false))
})

describe('Svix (Resend) signature', () => {
  const key = Buffer.from('super-secret-key-bytes')
  const secret = 'whsec_' + key.toString('base64')
  const body = '{"type":"email.bounced"}'
  const sig = (id: string, ts: string) => 'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  it('accepts valid, including one-of-many signatures', () => {
    expect(verifySvixSignature(body, { id: 'm1', timestamp: String(now), signature: sig('m1', String(now)) }, secret, now)).toBe(true)
    expect(verifySvixSignature(body, { id: 'm1', timestamp: String(now), signature: `v1,AAAA ${sig('m1', String(now))}` }, secret, now)).toBe(true)
  })
  it('rejects tampering, wrong id, stale timestamp', () => {
    expect(verifySvixSignature(body + 'x', { id: 'm1', timestamp: String(now), signature: sig('m1', String(now)) }, secret, now)).toBe(false)
    expect(verifySvixSignature(body, { id: 'm2', timestamp: String(now), signature: sig('m1', String(now)) }, secret, now)).toBe(false)
    expect(verifySvixSignature(body, { id: 'm1', timestamp: String(now - 400), signature: sig('m1', String(now - 400)) }, secret, now)).toBe(false)
  })
})

describe('action tokens', () => {
  it('stores a keyed hash that is not the token and is deterministic', () => {
    const t = 'abc123'
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t)).not.toContain(t)
    expect(hashToken(t)).toBe(hashToken(t))
    expect(hashToken(t)).not.toBe(hashToken(t + 'x'))
  })
  it('builds links on the app origin', () => expect(actionUrl('tok')).toBe('https://app.example.com/api/actions/tok'))
})
