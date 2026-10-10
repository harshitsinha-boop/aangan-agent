const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const pageHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}

export function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#faf6f1;color:#2b211a;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:#fff;border:1px solid #e6dccf;border-radius:16px;padding:28px;max-width:440px;width:100%}
h1{font-size:20px;margin:0 0 8px}p{line-height:1.5}dl{margin:12px 0}dt{color:#7a6b5d;font-size:13px}dd{margin:0 0 8px}
button{background:#7a4a2b;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:16px;cursor:pointer;width:100%}</style></head>
<body><main>${body}</main></body></html>`,
    { status, headers: pageHeaders },
  )
}

export type ConfirmContext = { rows: [string, string | null | undefined][] }

export const confirmPage = (title: string, blurb: string, ctx: ConfirmContext, button: string) =>
  page(
    title,
    `<h1>${esc(title)}</h1><p>${esc(blurb)}</p><dl>${ctx.rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<form method="post"><button type="submit">${esc(button)}</button></form>`,
  )

export const resultPage = (title: string, message: string, status = 200) =>
  page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`, status)

export const REFUSALS: Record<string, [string, string]> = {
  invalid: ['Link not recognised', 'This link is not valid. Please use the dashboard instead.'],
  used: ['Already used', 'This link has already been used. No further action is needed.'],
  expired: ['Link expired', 'This link has expired. Please use the dashboard instead.'],
  superseded: ['No longer current', 'This lead was reassigned, so this link no longer applies.'],
  already_accepted: ['Already accepted', 'This lead has already been accepted, so it cannot be reassigned from this link.'],
  already_acknowledged: ['Already acknowledged', 'Someone has already taken this escalation.'],
}
