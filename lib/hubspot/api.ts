// Thin HubSpot CRM v3 client. Only what the sync needs. Retries 429/5xx; errors never contain the access token.
const BASE = 'https://api.hubapi.com'

export type HsObject = { id: string; properties: Record<string, string | null> }
export class HubspotError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) { super(message) }
}

export class HubspotApi {
  constructor(private token: string, private fetchImpl: typeof fetch = fetch, private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let last: HubspotError | undefined
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await this.sleep(Math.min(8000, 500 * 2 ** attempt))
      const res = await this.fetchImpl(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return (res.status === 204 ? {} : await res.json()) as T
      const text = await res.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch { /* keep text */ }
      const msg = (parsed as { message?: string })?.message ?? text
      last = new HubspotError(`HubSpot ${method} ${path} failed: ${res.status} ${String(msg).slice(0, 200)}`, res.status, parsed)
      if (res.status === 429 || res.status >= 500) continue
      break
    }
    throw last!
  }

  async findContactByPhone(phone: string): Promise<HsObject | null> {
    const r = await this.call<{ results: HsObject[] }>('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] }],
      properties: ['firstname', 'lastname', 'phone', 'email'], limit: 1,
    })
    return r.results[0] ?? null
  }
  createContact(properties: Record<string, string>) { return this.call<HsObject>('POST', '/crm/v3/objects/contacts', { properties }) }
  updateContact(id: string, properties: Record<string, string>) { return this.call<HsObject>('PATCH', `/crm/v3/objects/contacts/${id}`, { properties }) }

  createDeal(properties: Record<string, string>, contactId: string) {
    return this.call<HsObject>('POST', '/crm/v3/objects/deals', {
      properties,
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }], // deal -> contact
    })
  }
  updateDeal(id: string, properties: Record<string, string>) { return this.call<HsObject>('PATCH', `/crm/v3/objects/deals/${id}`, { properties }) }

  createNote(body: string, dealId: string, contactId: string) {
    return this.call<HsObject>('POST', '/crm/v3/objects/notes', {
      properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() },
      associations: [
        { to: { id: dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] }, // note -> deal
        { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }, // note -> contact
      ],
    })
  }

  /** For the config check: the deal pipelines and their stage ids. */
  getDealPipelines() { return this.call<{ results: { id: string; label: string; stages: { id: string; label: string }[] }[] }>('GET', '/crm/v3/pipelines/deals') }
}
