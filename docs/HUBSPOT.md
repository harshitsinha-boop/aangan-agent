# HubSpot sync

**What it does** (only when `HUBSPOT_ACCESS_TOKEN` is set; otherwise it is skipped silently):
every qualified lead becomes a HubSpot **contact** (found by phone, never duplicated; an email clash adopts the existing contact), one **deal**
named `⭐? Name · Location · Project type` in your pipeline, and one **note** with the call summary, rubric checklist, uncertainty and a link
to the dashboard. The note never contains the transcript. When a lead moves (`accepted`, `consult_booked`, `won`, `lost`) or its
`project_value_inr` changes, the deal's **stage** and **amount** follow. HubSpot trouble never breaks a call: failures are stored on the lead
(`hubspot_error`, shown on the lead page) and the one-minute cron retries.

**Setup**
1. HubSpot → Settings → Integrations → **Private Apps** → create one with scopes `crm.objects.contacts.read/write` and `crm.objects.deals.read/write`. Copy the token into `HUBSPOT_ACCESS_TOKEN` (`.env.local` and Vercel).
2. `npm run hubspot:check` prints your deal pipelines and stage ids and verifies the mapping.
3. If your stage ids differ from HubSpot's defaults, edit the Supabase `config` row `hubspot` (`pipeline` + `stages` for `new, handed_off, accepted, consult_booked, won, lost`).

Not built: pushing calls as HubSpot "call" engagements, owner assignment (designer -> HubSpot owner), custom properties (area, referrer) as fields rather than note text.
