-- HubSpot sync bookkeeping. Our tables stay the system of record; these columns only remember what we pushed and when.
alter table public.callers add column if not exists hubspot_contact_id text;
alter table public.leads
  add column if not exists hubspot_deal_id   text,
  add column if not exists hubspot_status    text,          -- the lead.status last pushed (a difference triggers a re-sync)
  add column if not exists hubspot_value_inr numeric,          -- the project value last pushed
  add column if not exists hubspot_synced_at timestamptz,
  add column if not exists hubspot_error     text;
create index if not exists leads_hubspot_pending_idx on public.leads (created_at) where hubspot_synced_at is null;
