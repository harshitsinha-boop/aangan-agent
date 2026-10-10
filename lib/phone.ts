/** Normalise Indian-style and international numbers to E.164. Returns null if it cannot be made valid. */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (!s.startsWith('+')) {
    if (/^91[6-9]\d{9}$/.test(s)) s = '+' + s
    else if (/^0[6-9]\d{9}$/.test(s)) s = '+91' + s.slice(1)
    else if (/^[6-9]\d{9}$/.test(s)) s = '+91' + s
    else return null
  }
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null
}

/** For emails: last 4 digits only. */
export const phoneLast4 = (phone: string | null | undefined) => (phone ? `••••${phone.slice(-4)}` : 'not captured')
